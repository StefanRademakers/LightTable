import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer, moveLayer, setLayerBlendMode, setLayersLock,
  setLayerTransform } from '../../editor/document/documentCommands';
import { findDocumentLayer, siblingLayers } from '../../editor/document/layerTree';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { AuthenticatedLightTableMcpAdapter } from './lightTableMcpAdapter';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, LightTableCommandService,
  type LightTableCommandPorts } from './lightTableCommandService';
import type { SemanticLayerCommand } from './semanticLayerCommandContract';
import type { SemanticSelectionCommand } from './semanticSelectionCommandContract';

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
    return command.kind === 'set-lock'
      ? { layerIds: command.layerIds, lock: command.lock, locked: command.locked }
      : 'layerId' in command ? { ...command } : null;
  };
  const applySelection = (command: SemanticSelectionCommand) => {
    const before = selection;
    const after = command.mode === 'replace' ? [command] : [...before, command];
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
  const ports: LightTableCommandPorts = {
    setZoom: vi.fn(), createRasterLayer: vi.fn(), placeArtifact: vi.fn(), renameLayer: vi.fn(),
    setLayerVisibility: vi.fn(), setLayerFillOpacity: vi.fn(), setLayerStyleEnabled: vi.fn(),
    setLayerEffectEnabled: vi.fn(), executeTextCommand: vi.fn(), executeVectorCommand: vi.fn(),
    executeLayerStyleCommand: vi.fn(), executeLayerCommand: vi.fn((_documentId, command) => applyLayer(command)),
    executeSelectionCommand: vi.fn((_documentId, command) => applySelection(command)),
    executeAtomicBatch: vi.fn(), exportNativeArtifact: vi.fn(), exportPngArtifact: vi.fn(),
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
  return { workspace, session, service, adapter, topId, execute, snapshot, selectionSnapshot };
};

const steps = (layerId: string) => [
  { command: 'layer.setBlendMode', parameters: { layerId, blendMode: 'multiply' } },
  { command: 'layer.setLock', parameters: { layerIds: [layerId], lock: 'position', locked: true } },
  { command: 'layer.move', parameters: { layerId, direction: 'down' } },
  { command: 'layer.setLock', parameters: { layerIds: [layerId], lock: 'position', locked: false } },
  { command: 'layer.setTransform', parameters: {
    layerId, transform: { a: 1.25, b: 0, c: 0, d: 1.25, tx: 18, ty: -7 }
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
});
