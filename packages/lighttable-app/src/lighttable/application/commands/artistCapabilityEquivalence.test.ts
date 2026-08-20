import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { addLayerMask, createRasterLayer, moveLayer, removeLayerMask, setLayerBlendMode,
  setLayerMaskEnabled, setLayerMaskLinked, setLayersLock, setLayerTransform
} from '../../editor/document/documentCommands';
import { findDocumentLayer, siblingLayers } from '../../editor/document/layerTree';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { AuthenticatedLightTableMcpAdapter } from './lightTableMcpAdapter';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, LightTableCommandService,
  type LightTableCommandPorts } from './lightTableCommandService';
import type { SemanticLayerCommand } from './semanticLayerCommandContract';
import type { SemanticSelectionCommand } from './semanticSelectionCommandContract';
import type { SemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import { createDefaultAdjustments } from '../../types';
import { projectBasicAdjustmentValues } from '../adjustments/basicAdjustmentQuery';

const token = '0123456789abcdef0123456789abcdef';

const createHarness = () => {
  let documentSequence = 0;
  let historySequence = 0;
  const workspace = new WorkspaceSession({
    createId: () => `equivalence-${++documentSequence}` as never
  });
  const opened = workspace.open({ source: {
    id: 'fixture', name: 'Equivalence.lighttable', mediaType: 'application/x-lighttable'
  } });
  if (!opened.ok) throw new Error('Equivalence document could not open.');
  const session = opened.value;
  let selection: SemanticSelectionCommand[] = [];
  let basicAdjustments = createDefaultAdjustments();
  const withBottom = createRasterLayer(createImageDocument('Equivalence', 64, 64, 'fixture'), 'Bottom');
  const initial = createRasterLayer(withBottom, 'Top');
  session.setDocument(initial);
  session.setReady();
  const applyLayer = (command: SemanticLayerCommand) => {
    const before = session.getSnapshot().document!;
    let after = before;
    if (command.kind === 'set-blend-mode') {
      after = setLayerBlendMode(before, command.layerId, command.blendMode);
    } else if (command.kind === 'set-lock') {
      after = setLayersLock(before, [...command.layerIds], command.lock, command.locked);
    } else if (command.kind === 'move') {
      const siblings = siblingLayers(before, command.layerId);
      const index = siblings.findIndex(({ id }) => id === command.layerId);
      after = moveLayer(before, command.layerId, index + (command.direction === 'up' ? 1 : -1));
    } else if (command.kind === 'set-transform') {
      after = setLayerTransform(before, command.layerId, command.transform);
    } else if (command.kind === 'set-mask') {
      after = command.operation === 'add'
        ? addLayerMask(before, command.layerId)
        : command.operation === 'remove'
          ? removeLayerMask(before, command.layerId)
          : command.operation === 'set-enabled'
            ? setLayerMaskEnabled(before, command.layerId, command.enabled!)
            : setLayerMaskLinked(before, command.layerId, command.linked!);
    }
    if (after !== before) {
      session.setDocument(after);
      session.history.record({
        id: `equivalence-history-${++historySequence}`,
        type: `layer.${command.kind}`,
        label: command.kind,
        documentId: session.id,
        undo: () => session.setDocument(before),
        redo: () => session.setDocument(after)
      });
    }
    if (command.kind === 'set-lock') {
      return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
    }
    if (command.kind === 'move') {
      return { layerId: command.layerId, direction: command.direction };
    }
    if (command.kind === 'set-blend-mode') {
      return { layerId: command.layerId, blendMode: command.blendMode };
    }
    if (command.kind === 'set-transform') {
      return { layerId: command.layerId, transform: command.transform };
    }
    if (command.kind === 'set-mask') {
      return { layerId: command.layerId, operation: command.operation,
        ...(command.operation === 'add' ? { source: command.source ?? 'reveal-all' } : {}),
        ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
        ...(command.operation === 'set-linked' ? { linked: command.linked } : {}) };
    }
    return null;
  };
  const applySelection = (command: SemanticSelectionCommand) => {
    const before = selection;
    const after = command.kind === 'modify'
      ? command.operation === 'clear'
        ? []
        : command.operation === 'all'
          ? [command]
          : [...before, command]
      : command.mode === 'replace' ? [command] : [...before, command];
    selection = after;
    session.history.record({
      id: `equivalence-history-${++historySequence}`,
      type: 'selection.apply-shape',
      label: 'Apply selection shape',
      documentId: session.id,
      affectsDocument: false,
      undo: () => { selection = before; },
      redo: () => { selection = after; }
    });
    return { operationCount: selection.length };
  };
  const applyVector = (command: Parameters<typeof executeSemanticVectorCommand>[0]) => (
    executeSemanticVectorCommand(command, {
      getDocument: () => session.getSnapshot().document,
      applyDocument: (document) => session.setDocument(document),
      recordHistory: (before, after) => session.history.record({
        id: `equivalence-history-${++historySequence}`,
        type: `vector.${command.kind}`,
        label: command.kind,
        documentId: session.id,
        undo: () => session.setDocument(before),
        redo: () => session.setDocument(after)
      })
    })
  );
  const applyBasicAdjustment = (command: SemanticBasicAdjustmentCommand) => {
    if (command.target.kind !== 'document') {
      throw new Error('The equivalence fixture currently owns a document Grade target.');
    }
    const before = structuredClone(basicAdjustments);
    const after = { ...before, ...command.values };
    const changed = Object.keys(command.values).some((key) => (
      (before as unknown as Record<string, unknown>)[key]
        !== (after as unknown as Record<string, unknown>)[key]
    ));
    if (changed) {
      basicAdjustments = after;
      session.history.record({
        id: `equivalence-history-${++historySequence}`,
        type: 'adjustment.basic',
        label: 'Set Basic Grade',
        documentId: session.id,
        undo: () => { basicAdjustments = before; },
        redo: () => { basicAdjustments = after; }
      });
    }
    return { target: command.target, values: command.values, changed };
  };
  const ports: LightTableCommandPorts = {
    setZoom: vi.fn(), createRasterLayer: vi.fn(), placeArtifact: vi.fn(), renameLayer: vi.fn(),
    setLayerVisibility: vi.fn(), setLayerFillOpacity: vi.fn(), setLayerStyleEnabled: vi.fn(),
    setLayerEffectEnabled: vi.fn(), executeTextCommand: vi.fn(),
    executeVectorCommand: vi.fn((_documentId, command) => applyVector(command)),
    executeLayerStyleCommand: vi.fn(), executeLayerCommand: vi.fn((_documentId, command) => applyLayer(command)),
    executeSelectionCommand: vi.fn((_documentId, command) => applySelection(command)),
    executeBasicAdjustmentCommand: vi.fn((_documentId, command) => applyBasicAdjustment(command)),
    queryBasicAdjustments: vi.fn((_documentId, target) => target.kind === 'document' ? ({
      target,
      documentRevision: session.getSnapshot().document!.revision,
      targetRevision: session.getSnapshot().document!.revision,
      values: projectBasicAdjustmentValues(basicAdjustments)
    }) : null),
    executeAtomicBatch: vi.fn(), exportNativeArtifact: vi.fn(), exportPngArtifact: vi.fn(),
    exportPreviewArtifact: vi.fn(),
    exportLayerPreviewArtifact: vi.fn(),
    exportPsdArtifact: vi.fn(), beginGesture: vi.fn(), updateGesture: vi.fn(), finishGesture: vi.fn(),
    undo: vi.fn(() => session.history.undo()), redo: vi.fn(() => session.history.redo())
  };
  const service = new LightTableCommandService(workspace, ports);
  const adapter = new AuthenticatedLightTableMcpAdapter({
    driver: service, enabled: true, token, expiresAt: 2_000, now: () => 1_000
  });
  const topId = initial.activeLayerId!;
  const execute = (command: string, parameters: unknown) => service.execute({
    protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
    requestId: `equivalence-${command}-${crypto.randomUUID()}`,
    command,
    documentId: session.id,
    parameters
  });
  const snapshot = () => {
    const top = findDocumentLayer(session.getSnapshot().document!, topId)!;
    return {
      name: top.name,
      blendMode: top.blendMode,
      locks: { ...top.locks },
      transform: { ...top.transform },
      mask: top.mask ? { enabled: top.mask.enabled, linked: top.mask.linked,
        density: top.mask.density, feather: top.mask.feather } : null,
      order: session.getSnapshot().document!.layers.map(({ name }) => name),
      history: {
        undoDepth: session.history.getSnapshot().undoDepth,
        redoDepth: session.history.getSnapshot().redoDepth
      }
    };
  };
  const selectionSnapshot = () => ({
    selection: structuredClone(selection),
    canonicalRevision: service.queryDocument(session.id)!.canonicalRevision,
    history: {
      undoDepth: session.history.getSnapshot().undoDepth,
      redoDepth: session.history.getSnapshot().redoDepth,
      dirty: session.history.getSnapshot().dirty
    }
  });
  const designSnapshot = () => ({
    layers: session.getSnapshot().document!.layers.map((layer) => ({
      type: layer.type,
      name: layer.name,
      blendMode: layer.blendMode,
      elementKinds: layer.type === 'vector' ? layer.elements.map(({ type }) => type) : []
    })),
    selection: structuredClone(selection),
    history: {
      undoDepth: session.history.getSnapshot().undoDepth,
      redoDepth: session.history.getSnapshot().redoDepth
    }
  });
  const gradeSnapshot = () => ({
    values: {
      exposureEV: basicAdjustments.exposureEV,
      contrast: basicAdjustments.contrast,
      temperature: basicAdjustments.temperature,
      vibrance: basicAdjustments.vibrance
    },
    history: {
      undoDepth: session.history.getSnapshot().undoDepth,
      redoDepth: session.history.getSnapshot().redoDepth
    }
  });
  return { workspace, session, service, adapter, topId, execute, snapshot,
    selectionSnapshot, designSnapshot, gradeSnapshot };
};

const steps = (layerId: string) => [
  { command: 'layer.setBlendMode', parameters: { layerId, blendMode: 'multiply' } },
  { command: 'layer.setLock', parameters: { layerIds: [layerId], lock: 'position', locked: true } },
  { command: 'layer.move', parameters: { layerId, direction: 'down' } },
  { command: 'layer.setLock', parameters: { layerIds: [layerId], lock: 'position', locked: false } },
  { command: 'layer.setTransform', parameters: {
    layerId, transform: { a: 1.25, b: 0, c: 0, d: 1.25, tx: 18, ty: -7 }
  } },
  { command: 'layer.setMask', parameters: {
    layerId, operation: 'add', source: 'reveal-all'
  } },
  { command: 'layer.setMask', parameters: {
    layerId, operation: 'set-enabled', enabled: false
  } },
  { command: 'layer.setMask', parameters: {
    layerId, operation: 'set-linked', linked: false
  } }
] as const;

describe('artist capability equivalence harness', () => {
  it('ends with equivalent canonical layer state and history through UI, Actions and MCP', async () => {
    const ui = createHarness();
    for (const step of steps(ui.topId)) {
      expect(await ui.execute(step.command, step.parameters)).toMatchObject({ status: 'completed' });
    }

    const actions = createHarness();
    actions.service.startActionRecording('Layer treatment');
    for (const step of steps(actions.topId)) await actions.execute(step.command, step.parameters);
    actions.service.stopActionRecording();
    for (let index = 0; index < steps(actions.topId).length; index += 1) {
      await actions.execute('history.undo', {});
    }
    expect(await actions.service.playActionRecording()).toMatchObject({ status: 'completed' });

    const mcp = createHarness();
    for (const step of steps(mcp.topId)) {
      expect(await mcp.adapter.invoke({
        protocolVersion: 1, requestId: `mcp-${step.command}`, token,
        method: 'command.execute', parameters: {
          documentId: mcp.session.id, command: step.command,
          commandRequestId: `mcp-command-${step.command}`,
          expectedDocumentRevision: mcp.service.queryDocument(mcp.session.id)!.canonicalRevision,
          commandParameters: step.parameters
        }
      })).toMatchObject({ status: 'completed' });
    }

    expect(actions.snapshot()).toEqual(ui.snapshot());
    expect(mcp.snapshot()).toEqual(ui.snapshot());
    expect(actions.service.actionRecordingSnapshot().steps.map(({ command }) => command))
      .toEqual(steps(actions.topId).map(({ command }) => command));
    expect(mcp.adapter.activity().every(({ outcome }) => outcome === 'completed')).toBe(true);

    for (const harness of [ui, actions, mcp]) {
      harness.service.dispose();
      harness.workspace.dispose();
    }
  });

  it('applies the same final selection through UI, Actions and MCP without dirtying the document', async () => {
    const parameters = {
      mode: 'replace',
      shape: { kind: 'polygon', points: [
        { x: 8, y: 9 }, { x: 52, y: 11 }, { x: 30, y: 54 }
      ] },
      featherRadius: 2,
      antiAlias: true
    };
    const ui = createHarness();
    expect(await ui.execute('selection.applyShape', parameters)).toMatchObject({ status: 'completed' });

    const actions = createHarness();
    actions.service.startActionRecording('Select subject area');
    await actions.execute('selection.applyShape', parameters);
    actions.service.stopActionRecording();
    await actions.execute('history.undo', {});
    expect(await actions.service.playActionRecording()).toMatchObject({ status: 'completed' });

    const mcp = createHarness();
    expect(await mcp.adapter.invoke({
      protocolVersion: 1,
      requestId: 'mcp-selection-shape',
      token,
      method: 'command.execute',
      parameters: {
        documentId: mcp.session.id,
        command: 'selection.applyShape',
        commandRequestId: 'mcp-command-selection-shape',
        expectedDocumentRevision: mcp.service.queryDocument(mcp.session.id)!.canonicalRevision,
        commandParameters: parameters
      }
    })).toMatchObject({ status: 'completed' });

    expect(actions.selectionSnapshot()).toEqual(ui.selectionSnapshot());
    expect(mcp.selectionSnapshot()).toEqual(ui.selectionSnapshot());
    expect(ui.selectionSnapshot()).toMatchObject({ canonicalRevision: 0,
      history: { undoDepth: 1, redoDepth: 0, dirty: false } });

    for (const harness of [ui, actions, mcp]) {
      harness.service.dispose();
      harness.workspace.dispose();
    }
  });

  it('applies discrete selection state through equivalent UI, Actions and MCP routes', async () => {
    const operations = ['all', 'invert', 'clear'] as const;
    const ui = createHarness();
    for (const operation of operations) {
      expect(await ui.execute('selection.modify', { kind: 'modify', operation }))
        .toMatchObject({ status: 'completed' });
    }

    const actions = createHarness();
    actions.service.startActionRecording('Selection state');
    for (const operation of operations) {
      await actions.execute('selection.modify', { kind: 'modify', operation });
    }
    actions.service.stopActionRecording();
    for (let index = 0; index < operations.length; index += 1) {
      await actions.execute('history.undo', {});
    }
    expect(await actions.service.playActionRecording()).toMatchObject({ status: 'completed' });

    const mcp = createHarness();
    for (const operation of operations) {
      expect(await mcp.adapter.invoke({
        protocolVersion: 1,
        requestId: `mcp-selection-${operation}`,
        token,
        method: 'command.execute',
        parameters: {
          documentId: mcp.session.id,
          command: 'selection.modify',
          commandRequestId: `mcp-command-selection-${operation}`,
          expectedDocumentRevision: 0,
          commandParameters: { kind: 'modify', operation }
        }
      })).toMatchObject({ status: 'completed' });
    }

    expect(actions.selectionSnapshot()).toEqual(ui.selectionSnapshot());
    expect(mcp.selectionSnapshot()).toEqual(ui.selectionSnapshot());
    expect(ui.selectionSnapshot()).toMatchObject({
      canonicalRevision: 0,
      history: { undoDepth: 3, redoDepth: 0, dirty: false }
    });

    for (const harness of [ui, actions, mcp]) {
      harness.service.dispose();
      harness.workspace.dispose();
    }
  });

  it('applies one final basic Grade patch through equivalent UI, Actions and MCP routes', async () => {
    const parameters = {
      target: { kind: 'document' as const },
      values: { exposureEV: 0.45, contrast: 18, temperature: -7, vibrance: 22 }
    };
    const ui = createHarness();
    expect(await ui.execute('grade.setBasic', parameters)).toMatchObject({ status: 'completed' });

    const actions = createHarness();
    actions.service.startActionRecording('Basic grade');
    await actions.execute('grade.setBasic', parameters);
    actions.service.stopActionRecording();
    await actions.execute('history.undo', {});
    expect(await actions.service.playActionRecording()).toMatchObject({ status: 'completed' });

    const mcp = createHarness();
    expect(await mcp.adapter.invoke({
      protocolVersion: 1,
      requestId: 'mcp-basic-grade',
      token,
      method: 'command.execute',
      parameters: {
        documentId: mcp.session.id,
        command: 'grade.setBasic',
        commandRequestId: 'mcp-command-basic-grade',
        expectedDocumentRevision: mcp.service.queryDocument(mcp.session.id)!.canonicalRevision,
        commandParameters: parameters
      }
    })).toMatchObject({ status: 'completed' });

    const beforeQuery = mcp.gradeSnapshot().history;
    expect(await mcp.adapter.invoke({
      protocolVersion: 1,
      requestId: 'mcp-query-basic-grade',
      token,
      method: 'grade.queryBasic',
      parameters: { documentId: mcp.session.id, target: { kind: 'document' } }
    })).toMatchObject({
      status: 'completed',
      value: { target: { kind: 'document' }, values: parameters.values }
    });
    expect(mcp.gradeSnapshot().history).toEqual(beforeQuery);

    expect(actions.gradeSnapshot()).toEqual(ui.gradeSnapshot());
    expect(mcp.gradeSnapshot()).toEqual(ui.gradeSnapshot());
    expect(ui.gradeSnapshot()).toEqual({
      values: { exposureEV: 0.45, contrast: 18, temperature: -7, vibrance: 22 },
      history: { undoDepth: 1, redoDepth: 0 }
    });
    for (const harness of [ui, actions, mcp]) {
      harness.service.dispose();
      harness.workspace.dispose();
    }
  });

  it('records and replays a mixed layer, shape and selection mini-design with stable result binding', async () => {
    const state = createHarness();
    state.service.startActionRecording('Badge composition');
    const created = await state.execute('vector.create', {
      name: 'Badge',
      primitive: { kind: 'ellipse', x: 8, y: 8, width: 48, height: 48 },
      style: { fill: { type: 'solid', color: [0.1, 0.4, 0.9, 1] } }
    });
    expect(created).toMatchObject({ status: 'completed' });
    if (created.status !== 'completed' || typeof created.value !== 'object' || !created.value) {
      throw new Error('Vector shape did not return its stable identity.');
    }
    const layerId = (created.value as { layerId: string }).layerId;
    await state.execute('selection.applyShape', {
      mode: 'replace',
      shape: { kind: 'ellipse', points: [{ x: 8, y: 8 }, { x: 56, y: 56 }] },
      featherRadius: 1,
      antiAlias: true
    });
    await state.execute('layer.setBlendMode', { layerId, blendMode: 'screen' });
    state.service.stopActionRecording();
    const expected = state.designSnapshot();

    for (let index = 0; index < 3; index += 1) await state.execute('history.undo', {});
    expect(await state.service.playActionRecording()).toMatchObject({ status: 'completed' });
    expect(state.designSnapshot()).toEqual(expected);
    expect(state.service.actionRecordingSnapshot().steps[2].parameters).toMatchObject({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }
    });

    state.service.dispose();
    state.workspace.dispose();
  });
});
