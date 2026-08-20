import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer, createTextLayer, duplicateLayer, groupLayers, renameLayer,
  setLayerBlendMode } from '../../editor/document/documentCommands';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { LIGHTTABLE_COMMAND_SCHEMAS, validateJsonSchemaValue } from '@lighttable/command-contract';
import type { SemanticActionLibraryStorage } from '../actions/semanticActionLibrary';
import { addLayerStyle } from '../../editor/styles/layerStyleCommands';
import { WorkspaceSession } from '../workspace/workspaceSession';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  LightTableCommandPortRegistry,
  LightTableCommandService,
  type LightTableCommandPorts
} from './lightTableCommandService';

const setup = (overrides: Partial<LightTableCommandPorts> = {},
  actionLibraryStorage?: SemanticActionLibraryStorage) => {
  let id = 0;
  const workspace = new WorkspaceSession({
    createId: () => `document-${++id}` as never
  });
  const opened = workspace.open({
    source: { id: 'source-1', name: 'Fixture.psd', mediaType: 'image/vnd.adobe.photoshop' }
  });
  if (!opened.ok) throw new Error('Fixture document failed to open.');
  const session = opened.value;
  session.setDocument(createRasterLayer(createImageDocument('Fixture', 80, 60, 'source-1')));
  session.setReady();
  const ports: LightTableCommandPorts = {
    resizeImage: vi.fn(),
    applyDocumentGeometry: vi.fn(),
    setZoom: vi.fn((_documentId, viewport) => session.updateViewport(() => viewport)),
    createRasterLayer: vi.fn(() => {
      session.setDocument(createRasterLayer(session.getSnapshot().document!));
    }),
    placeArtifact: vi.fn(),
    renameLayer: vi.fn(),
    setLayerVisibility: vi.fn(),
    setLayerFillOpacity: vi.fn(),
    setLayerStyleEnabled: vi.fn(),
    setLayerEffectEnabled: vi.fn(),
    executeTextCommand: vi.fn(),
    executeVectorCommand: vi.fn(),
    executeWarpStrokeCommand: vi.fn(),
    executeFillCommand: vi.fn(),
    executeRasterGradientCommand: vi.fn(),
    executeLayerStyleCommand: vi.fn(),
    executeFaceWarpCommand: vi.fn(),
    executeLayerCommand: vi.fn(),
    executeFixedTransform: vi.fn(),
    executeAdjustmentCreation: vi.fn(),
    executeRasterInvert: vi.fn(),
    executeTextToShape: vi.fn(),
    executeTextRasterize: vi.fn(),
    executeLayerMerge: vi.fn(),
    executeFlattenGroup: vi.fn(),
    executeFlattenImage: vi.fn(),
    executeBackgroundRemoval: vi.fn(async (_documentId, command, _signal, report) => {
      report(0.5, 'Removing background');
      return { ...command, modelId: 'fixture' };
    }),
    executeAutoAlign: vi.fn(async (_documentId, command) => ({ ...command, changed: true,
      correctionMatrix: { a: 1, b: 0, c: 0, d: 1, tx: -4, ty: 2 } })),
    executeAtomicBatch: vi.fn(),
    exportNativeArtifact: vi.fn(async () => new File(['native'], 'test.lighttable')),
    exportPngArtifact: vi.fn(async () => new File(['png'], 'test.png', { type: 'image/png' })),
    exportPreviewArtifact: vi.fn(async (_documentId, maxEdge) =>
      new File(['preview'], `preview-${maxEdge}.png`, { type: 'image/png' })),
    exportPsdArtifact: vi.fn(async () => new File(['psd'], 'test.psd', { type: 'image/vnd.adobe.photoshop' })),
    beginGesture: vi.fn(async () => true),
    updateGesture: vi.fn(async () => true),
    finishGesture: vi.fn(async () => true),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true),
    ...overrides,
    exportLayerPreviewArtifact: overrides.exportLayerPreviewArtifact ?? vi.fn(async () => ({
      file: new File(['layer'], 'layer.png', { type: 'image/png' }), width: 40, height: 30,
      sourceToOutput: { a: 0.5, b: 0, c: 0, d: 0.5, tx: 0, ty: 0 }
    }))
  };
  const service = new LightTableCommandService(workspace, ports, undefined, undefined,
    actionLibraryStorage);
  return { workspace, session, ports, service };
};

const request = (command: string, documentId: string, parameters: unknown = {}) => ({
  protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  requestId: `request-${command}`,
  command,
  documentId,
  parameters
});
const automationBrush = {
  presetId: 'round', size: 24, hardness: 0.75, opacity: 1, flow: 0.5,
  spacing: 0.05, smooth: 0.2, color: '#112233', backgroundColor: '#ffffff'
};
const warpStroke = (layerId: string) => ({ layerId, mode: 'push',
  settings: { diameterPx: 120, strength: 0.5, hardness: 0.6, flow: 1,
    spacing: 0.1, smooth: 0, pressureSize: true, pressureStrength: true },
  samples: [{ positionPx: [10, 20], deltaPx: [0, 0], pressure: 1,
    tilt: [0, 0], timeMs: 1000 }], startedAtMs: 1000, durationMs: 0 });
const rasterGradient = (layerId: string) => ({ layerId, channel: 'pixels',
  paint: { ...createDefaultGradientPaint('raster-command', 'document'),
    transform: { a: 120, b: 0, c: 0, d: 120, tx: 10, ty: 20 } },
  opacity: 0.8, blendMode: 'normal' });
const basicValues = {
  temperature: 0, tint: 0, exposureEV: 0.75, contrast: 0,
  highlights: 0, shadows: 0, whites: 0, blacks: 0, lift: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 12, saturation: 0
};

describe('LightTableCommandService action recording', () => {
  it('records, enriches and awaits an asynchronous export during playback', async () => {
    const state = setup();
    state.service.startActionRecording('Export proof');
    const accepted = await state.service.execute(request('file.exportNative', state.session.id));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Export was not accepted.');
    await vi.waitFor(() => expect(
      state.service.queryTask(state.session.id, accepted.taskId)?.status
    ).toBe('completed'));
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'file.exportNative', outcome: 'accepted', replayable: true,
      result: { taskId: accepted.taskId, artifact: { id: expect.any(String) } }
    }]);

    await state.service.playActionRecording();

    expect(state.ports.exportNativeArtifact).toHaveBeenCalledTimes(2);
    expect(state.service.actionPlaybackSnapshot()).toMatchObject({
      status: 'completed', taskProgress: null,
      results: [{ command: 'file.exportNative', status: 'completed' }]
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('records and awaits cancellable background removal during Actions playback', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    state.service.startActionRecording('Subject mask');
    const accepted = await state.service.execute(request('layer.removeBackground', state.session.id,
      { layerId, mode: 'replace' }));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Remove Background was not accepted.');
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId))
      .toMatchObject({ status: 'completed', progress: 1 }));
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'layer.removeBackground', outcome: 'accepted', replayable: true,
      parameters: { layerId, mode: 'replace' }, result: { taskId: accepted.taskId, modelId: 'fixture' }
    }]);

    await state.service.playActionRecording();

    expect(state.ports.executeBackgroundRemoval).toHaveBeenCalledTimes(2);
    expect(state.service.actionPlaybackSnapshot()).toMatchObject({
      status: 'completed', results: [{ command: 'layer.removeBackground', status: 'completed' }]
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('cancels a running background-removal task through the shared task owner', async () => {
    const executeBackgroundRemoval = vi.fn((_documentId, _command, signal: AbortSignal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('Canceled', 'AbortError')), { once: true })));
    const state = setup({ executeBackgroundRemoval });
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    const accepted = await state.service.execute(request('layer.removeBackground', state.session.id,
      { layerId, mode: 'replace' }));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Remove Background was not accepted.');
    await expect(state.service.execute(request('task.cancel', state.session.id,
      { taskId: accepted.taskId }))).resolves.toMatchObject({ status: 'completed' });
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId)?.status)
      .toBe('canceled'));
    expect(executeBackgroundRemoval.mock.calls[0]?.[2].aborted).toBe(true);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects malformed or missing background-removal targets before starting work', async () => {
    const state = setup();
    await expect(state.service.execute(request('layer.removeBackground', state.session.id,
      { layerId: 'missing', mode: 'replace' }))).resolves.toMatchObject({
      status: 'rejected', code: 'command-unavailable'
    });
    await expect(state.service.execute(request('layer.removeBackground', state.session.id,
      { layerId: 'missing', mode: 'merge' }))).resolves.toMatchObject({
      status: 'rejected', code: 'invalid-parameters'
    });
    expect(state.ports.executeBackgroundRemoval).not.toHaveBeenCalled();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('records and awaits explicit Auto Align during Actions playback', async () => {
    const state = setup();
    const rasterIds = state.session.getSnapshot().document!.layers
      .filter(({ type }) => type === 'raster').map(({ id }) => id);
    const [targetLayerId, referenceLayerId] = rasterIds;
    expect(referenceLayerId).toBeTruthy();
    state.service.startActionRecording('Align layers');
    const accepted = await state.service.execute(request('layer.autoAlign', state.session.id,
      { referenceLayerId, targetLayerId }));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Auto Align was not accepted.');
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId)?.status)
      .toBe('completed'));
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'layer.autoAlign', outcome: 'accepted', replayable: true,
      parameters: { referenceLayerId, targetLayerId },
      result: { taskId: accepted.taskId, changed: true }
    }]);

    await state.service.playActionRecording();

    expect(state.ports.executeAutoAlign).toHaveBeenCalledTimes(2);
    expect(state.service.actionPlaybackSnapshot()).toMatchObject({
      status: 'completed', results: [{ command: 'layer.autoAlign', status: 'completed' }]
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('cancels a running Auto Align through the document task owner', async () => {
    const executeAutoAlign = vi.fn((_documentId, _command, signal: AbortSignal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('Canceled', 'AbortError')), { once: true })));
    const state = setup({ executeAutoAlign });
    const rasterIds = state.session.getSnapshot().document!.layers
      .filter(({ type }) => type === 'raster').map(({ id }) => id);
    const accepted = await state.service.execute(request('layer.autoAlign', state.session.id,
      { targetLayerId: rasterIds[0], referenceLayerId: rasterIds[1] }));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Auto Align was not accepted.');
    await state.service.execute(request('task.cancel', state.session.id, { taskId: accepted.taskId }));
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId)?.status)
      .toBe('canceled'));
    expect(executeAutoAlign.mock.calls[0]?.[2].aborted).toBe(true);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects hidden and position-locked Auto Align targets before analysis', async () => {
    const state = setup();
    const initial = state.session.getSnapshot().document!;
    const rasterIds = initial.layers.filter(({ type }) => type === 'raster').map(({ id }) => id);
    const [targetLayerId, referenceLayerId] = rasterIds;
    state.session.setDocument({ ...initial, revision: initial.revision + 1,
      layers: initial.layers.map((layer) => layer.id === targetLayerId
        ? { ...layer, visible: false } : layer) });
    await expect(state.service.execute(request('layer.autoAlign', state.session.id,
      { targetLayerId, referenceLayerId }))).resolves.toMatchObject({
      status: 'rejected', code: 'command-unavailable'
    });
    const hidden = state.session.getSnapshot().document!;
    state.session.setDocument({ ...hidden, revision: hidden.revision + 1,
      layers: hidden.layers.map((layer) => layer.id === targetLayerId
        ? { ...layer, visible: true, locks: { ...layer.locks, position: true } } : layer) });
    await expect(state.service.execute(request('layer.autoAlign', state.session.id,
      { targetLayerId, referenceLayerId }))).resolves.toMatchObject({
      status: 'rejected', code: 'command-unavailable'
    });
    expect(state.ports.executeAutoAlign).not.toHaveBeenCalled();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('stops playback by canceling the current document task owner', async () => {
    const state = setup({ exportNativeArtifact: vi.fn(() => new Promise<File>(() => undefined)) });
    state.service.startActionRecording('Cancelable export');
    const recorded = await state.service.execute(request('file.exportNative', state.session.id));
    expect(recorded.status).toBe('accepted');
    state.service.stopActionRecording();

    const playing = state.service.playActionRecording();
    await vi.waitFor(() => expect(state.service.actionPlaybackSnapshot().currentSequence).toBe(1));
    const taskId = state.session.tasks.getSnapshot().activeTaskIds[0];
    expect(taskId).toBeTruthy();
    state.service.stopActionPlayback();
    await playing;

    expect(state.service.queryTask(state.session.id, taskId!)?.status).toBe('canceled');
    expect(state.service.actionPlaybackSnapshot().status).toBe('stopped');
    state.service.dispose();
    state.workspace.dispose();
  });


  it('saves and restores a named Action through the injected storage boundary', async () => {
    let persisted: string | null = null;
    const storage: SemanticActionLibraryStorage = {
      read: () => persisted,
      write: (value) => { persisted = value; }
    };
    const first = setup({}, storage);
    first.service.startActionRecording('Draft');
    await first.service.execute(request('layer.createRaster', first.session.id));
    first.service.stopActionRecording();
    expect(await first.service.saveActionRecording('Fresh layer')).toMatchObject({ name: 'Fresh layer' });
    first.service.dispose();

    const restored = new LightTableCommandService(first.workspace, first.ports,
      undefined, undefined, storage);
    expect(restored.actionLibrarySnapshot()).toMatchObject({
      actions: [{ name: 'Fresh layer', recording: { steps: [{ command: 'layer.createRaster' }] } }]
    });
    const actionId = restored.actionLibrarySnapshot().actions[0]!.id;
    expect((await restored.loadSavedAction(actionId))?.name).toBe('Fresh layer');
    await restored.playActionRecording();
    expect(first.ports.createRasterLayer).toHaveBeenCalledTimes(2);
    restored.dispose();
    first.workspace.dispose();
  });

  it('records one already-committed UI owner result without executing it twice', () => {
    const state = setup();
    state.service.startActionRecording('Observed UI commit');
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(0);
    expect(state.service.recordObservedCommand(
      'selection.applyShape',
      state.session.id,
      {
        mode: 'replace',
        shape: { kind: 'rectangle', points: [{ x: 2, y: 3 }, { x: 20, y: 30 }] },
        featherRadius: 0,
        antiAlias: false
      },
      {
        mode: 'replace',
        shape: { kind: 'rectangle', points: [{ x: 2, y: 3 }, { x: 20, y: 30 }] },
        featherRadius: 0,
        antiAlias: false
      }
    )).toBe(true);
    expect(state.ports.executeSelectionCommand).toBeUndefined();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'selection.applyShape', outcome: 'completed', replayable: true,
      origin: 'ui'
    }]);
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(0);
    expect(state.service.recordObservedCommand(
      'layer.setTransform', state.session.id, {
        layerId: state.session.getSnapshot().document!.activeLayerId,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 8 }
      }, { layerId: state.session.getSnapshot().document!.activeLayerId,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 8 } }
    )).toBe(true);
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(1);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('refuses an invalid observed UI text commit before revision or recording publication', () => {
    const state = setup();
    state.service.startActionRecording('Invalid observed text');
    expect(state.service.recordObservedCommand(
      'text.replaceRange', state.session.id,
      { layerId: 'text-layer', start: 9, end: 2, text: 'invalid' },
      { layerId: 'text-layer' }
    )).toBe(false);
    expect(state.service.actionRecordingSnapshot().steps).toEqual([]);
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(0);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('records only schema-compatible observed results after publishing the committed revision', () => {
    const state = setup();
    state.service.startActionRecording('Invalid observed result');

    expect(state.service.recordObservedCommand(
      'text.format', state.session.id,
      { layerId: 'text-layer', style: { syntheticBold: true } },
      { layerId: 'text-layer', changed: true }
    )).toBe(false);
    expect(state.service.actionRecordingSnapshot().steps).toEqual([]);
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(1);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('does not republish a UI observation raised by an executing semantic command', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId;
    state.ports.renameLayer = vi.fn((_documentId, targetLayerId, name) => {
      state.session.setDocument(renameLayer(state.session.getSnapshot().document!, targetLayerId, name));
      expect(state.service.recordObservedCommand('layer.rename', state.session.id,
        { layerId: targetLayerId, name }, { layerId: targetLayerId, name })).toBe(false);
    });
    state.service.startActionRecording('One semantic rename');
    await state.service.execute(request('layer.rename', state.session.id, { layerId, name: 'Only once' }));
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(1);
    expect(state.service.actionRecordingSnapshot().steps).toHaveLength(1);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('observes the same command execution path used by normal callers', async () => {
    const state = setup();
    const changed = vi.fn();
    const unsubscribe = state.service.subscribeActionRecording(changed);
    state.service.startActionRecording('UI trace');

    await state.service.execute(request('layer.createRaster', state.session.id));
    state.service.stopActionRecording();
    await state.service.playActionRecording();

    expect(state.service.actionRecordingSnapshot()).toMatchObject({
      status: 'stopped', name: 'UI trace',
      steps: [{ command: 'layer.createRaster', origin: 'ui', parameters: {},
        outcome: 'completed', replayable: true }]
    });
    expect(changed).toHaveBeenCalled();
    expect(state.ports.createRasterLayer).toHaveBeenCalledTimes(2);
    expect(state.service.actionPlaybackSnapshot()).toMatchObject({
      status: 'completed', results: [{ command: 'layer.createRaster', status: 'completed' }]
    });
    unsubscribe();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('does not record playback back into an active recording', async () => {
    const state = setup();
    state.service.startActionRecording('No recursion');
    await state.service.execute(request('layer.createRaster', state.session.id));

    await state.service.playActionRecording();

    expect(state.service.actionRecordingSnapshot().steps).toHaveLength(1);
    expect(state.service.actionRecordingSnapshot().steps[0]).toMatchObject({
      command: 'layer.createRaster', origin: 'ui'
    });
    expect(state.ports.createRasterLayer).toHaveBeenCalledTimes(2);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rebinds a create-then-rename action to the layer created by each playback', async () => {
    const state = setup();
    state.ports.createRasterLayer = vi.fn(() => {
      state.session.setDocument(createRasterLayer(state.session.getSnapshot().document!));
    });
    state.ports.renameLayer = vi.fn((_documentId, layerId, name) => {
      state.session.setDocument(renameLayer(state.session.getSnapshot().document!, layerId, name));
    });
    state.service.startActionRecording('Create title layer');
    const created = await state.service.execute(request('layer.createRaster', state.session.id));
    expect(created).toMatchObject({ status: 'completed', value: { layerId: expect.any(String) } });
    if (created.status !== 'completed') throw new Error('Create failed.');
    const recordedLayerId = (created.value as { layerId: string }).layerId;
    await state.service.execute(request('layer.rename', state.session.id, {
      layerId: recordedLayerId, name: 'Title'
    }));
    state.service.stopActionRecording();

    expect(state.service.actionRecordingSnapshot().steps[1]?.parameters).toEqual({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Title'
    });
    await state.service.playActionRecording();

    const renameCalls = vi.mocked(state.ports.renameLayer).mock.calls;
    expect(renameCalls).toHaveLength(2);
    expect(renameCalls[1]?.[1]).not.toBe(recordedLayerId);
    expect(renameCalls[1]?.slice(1)).toEqual([
      state.session.getSnapshot().document!.activeLayerId, 'Title'
    ]);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects raster creation when the mounted owner produces no stable layer', async () => {
    const state = setup({ createRasterLayer: vi.fn() });
    const before = state.session.getSnapshot().document;

    const result = await state.service.execute(request('layer.createRaster', state.session.id));

    expect(result).toMatchObject({
      status: 'rejected', code: 'execution-failed', message: 'The raster layer was not created.'
    });
    expect(state.session.getSnapshot().document).toBe(before);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rebinds later layer operations to the duplicate created during playback', async () => {
    const state = setup();
    vi.mocked(state.ports.executeLayerCommand).mockImplementation((_documentId, command) => {
      const before = state.session.getSnapshot().document!;
      if (command.kind === 'duplicate') {
        const after = duplicateLayer(before, command.layerId);
        state.session.setDocument(after);
        return { sourceLayerId: command.layerId, layerId: after.activeLayerId };
      }
      if (command.kind === 'set-blend-mode') {
        state.session.setDocument(setLayerBlendMode(before, command.layerId, command.blendMode));
        return { layerId: command.layerId, blendMode: command.blendMode };
      }
      return null;
    });
    const sourceLayerId = state.session.getSnapshot().document!.activeLayerId!;
    state.service.startActionRecording('Duplicate and blend');
    const duplicate = await state.service.execute(request('layer.duplicate', state.session.id,
      { layerId: sourceLayerId }));
    if (duplicate.status !== 'completed') throw new Error('Duplicate failed.');
    expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS['layer.duplicate']!.result,
      duplicate.value).valid).toBe(true);
    const recordedCopyId = (duplicate.value as { layerId: string }).layerId;
    await state.service.execute(request('layer.setBlendMode', state.session.id,
      { layerId: recordedCopyId, blendMode: 'multiply' }));
    state.service.stopActionRecording();

    expect(state.service.actionRecordingSnapshot().steps[1]?.parameters).toEqual({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } },
      blendMode: 'multiply'
    });
    await state.service.playActionRecording();
    const calls = vi.mocked(state.ports.executeLayerCommand).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[3]?.[1]).toMatchObject({
      kind: 'set-blend-mode', blendMode: 'multiply'
    });
    expect((calls[3]?.[1] as { layerId: string }).layerId).not.toBe(recordedCopyId);
    state.service.dispose(); state.workspace.dispose();
  });

  it('records and replays Layer via Copy with an explicit raster source', async () => {
    const state = setup();
    vi.mocked(state.ports.executeLayerCommand).mockImplementation((_documentId, command) => {
      if (command.kind !== 'copy-to-new-layer') return null;
      const before = state.session.getSnapshot().document!;
      const after = duplicateLayer(before, command.layerId);
      state.session.setDocument(after);
      return { sourceLayerId: command.layerId, layerId: after.activeLayerId, scope: 'layer' };
    });
    const sourceLayerId = state.session.getSnapshot().document!.activeLayerId!;
    state.service.startActionRecording('Layer via Copy');
    const copied = await state.service.execute(request('layer.copyToNewLayer', state.session.id,
      { layerId: sourceLayerId }));
    state.service.stopActionRecording();

    expect(copied).toMatchObject({ status: 'completed',
      value: { sourceLayerId, layerId: expect.any(String), scope: 'layer' } });
    if (copied.status === 'completed') expect(validateJsonSchemaValue(
      LIGHTTABLE_COMMAND_SCHEMAS['layer.copyToNewLayer']!.result, copied.value
    ).valid).toBe(true);
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'layer.copyToNewLayer', replayable: true, parameters: { layerId: sourceLayerId }
    }]);

    await state.service.playActionRecording();

    expect(state.ports.executeLayerCommand).toHaveBeenCalledTimes(2);
    expect(state.service.actionPlaybackSnapshot()).toMatchObject({
      status: 'completed', results: [{ command: 'layer.copyToNewLayer', status: 'completed' }]
    });
    state.service.dispose(); state.workspace.dispose();
  });
});

describe('LightTableCommandService queries', () => {
  it('exposes document-scoped render telemetry without making it document state', () => {
    const state = setup();
    const telemetry = {
      renderCalls: 2, submittedFrames: 2, noWorkSkips: 0, correctionFrames: 0,
      scopeAnalysisPasses: 0, scopeDisplayPasses: 0, stages: {}
    } as never;
    state.ports.queryRenderTelemetry = vi.fn(() => telemetry);
    state.ports.resetRenderTelemetry = vi.fn();

    expect(state.service.queryRenderTelemetry(state.session.id)).toBe(telemetry);
    expect(state.service.resetRenderTelemetry(state.session.id)).toBe(true);
    expect(state.ports.resetRenderTelemetry).toHaveBeenCalledWith(state.session.id);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('projects bounded workspace, document and layer summaries', () => {
    const state = setup();
    const workspace = state.service.queryWorkspace();
    const document = state.service.queryDocument(state.session.id)!;
    const layers = state.service.queryLayers(state.session.id)!;

    expect(workspace.activeDocumentId).toBe(state.session.id);
    expect(workspace.documents).toEqual([expect.objectContaining({ title: 'Fixture.psd' })]);
    expect(workspace.documents[0]).not.toHaveProperty('document');
    expect(document.canvas).toEqual({ width: 80, height: 60 });
    expect(document.layerCount).toBe(2);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(expect.objectContaining({
      depth: 0,
      hasMask: false,
      maskContent: {
        raster: null,
        preservedVector: false,
        simultaneousRasterAndVector: false
      },
      rasterSurface: { width: 80, height: 60, offsetX: 0, offsetY: 0 }
    }));
    state.service.dispose();
    state.workspace.dispose();
  });

  it('uses the same canonical capability projection for unavailable commands', () => {
    const state = setup();
    expect(state.service.queryCapabilities(state.session.id)).toContainEqual({
      command: 'history.undo',
      available: false,
      reason: 'There is nothing to undo.'
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('projects bounded canonical vector paint and stroke semantics for automation', () => {
    const state = setup();
    const document = state.session.getSnapshot().document!;
    const shape = createVectorLiveShape('badge', { kind: 'ellipse', width: 40, height: 20 });
    shape.style.fill = createDefaultGradientPaint('fill', 'object-bounds');
    shape.style.stroke = {
      paint: createDefaultGradientPaint('stroke', 'object-bounds'), opacity: 0.4,
      width: 200, alignment: 'outside', cap: 'square', join: 'miter',
      miterLimit: 12, dash: [8, 3], dashOffset: 2
    };
    shape.style.opacity = 0.75;
    const vector = createVectorLayer([shape], 'Badge');
    state.session.setDocument({
      ...document,
      layers: [...document.layers, vector],
      activeLayerId: vector.id,
      revision: document.revision + 1
    });

    expect(state.service.queryLayers(state.session.id)?.at(-1)?.vectorContent).toEqual({
      elementCount: 1,
      truncated: false,
      elements: [expect.objectContaining({
        id: 'badge', elementType: 'live-shape', fill: 'gradient', opacity: 0.75,
        stroke: {
          paint: 'gradient', opacity: 0.4, width: 200, alignment: 'outside',
          cap: 'square', join: 'miter', miterLimit: 12, dash: [8, 3], dashOffset: 2
        }
      })]
    });
    expect(state.service.queryVector(state.session.id, vector.id)).toMatchObject({
      layerId: vector.id, totalElements: 1, truncated: false,
      elements: [expect.objectContaining({ id: 'badge', type: 'live-shape' })]
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('projects MCP layer pages without inline vector geometry', () => {
    const state = setup();
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    const first = state.service.queryLayerPage({ documentId: state.session.id,
      expectedDocumentRevision: revision, limit: 1 });
    expect(first).toMatchObject({ status: 'completed', canonicalRevision: revision,
      offset: 0, limit: 1, truncated: true, layers: [{}] });
    if (first.status !== 'completed') throw new Error('Expected layer page.');
    expect(state.service.queryLayerPage({ documentId: state.session.id,
      cursor: first.nextCursor, limit: 1 })).toMatchObject({
      status: 'completed', offset: 1, truncated: false, layers: [{}]
    });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('inspects the active layer through one compact revision-bound query', () => {
    const state = setup();
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    expect(state.service.queryLayerDetail({ documentId: state.session.id,
      expectedDocumentRevision: revision })).toMatchObject({
      status: 'completed', canonicalRevision: revision, resolvedFrom: 'active-layer',
      content: { kind: 'raster' },
      availableQueries: expect.arrayContaining(['layer.preview:pixels'])
    });
    expect(state.service.queryLayerDetail({ documentId: state.session.id,
      expectedDocumentRevision: revision + 1 })).toMatchObject({
      status: 'rejected', code: 'stale-document-revision', currentRevision: revision
    });
    state.service.dispose(); state.workspace.dispose();
  });

  it('projects bounded editable text without font bytes', () => {
    const state = setup();
    const text = createDefaultTextLayerData();
    const value = 'A'.repeat(5_000);
    const source = text.source.kind === 'flow' ? { ...text.source, text: value,
      styleRuns: text.source.styleRuns.map((run) => ({ ...run, end: value.length })),
      paragraphRuns: text.source.paragraphRuns.map((run) => ({ ...run, end: value.length })) } : text.source;
    state.session.setDocument(createTextLayer(state.session.getSnapshot().document!, { ...text, source }, 'Long text'));
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    const projected = state.service.queryText(state.session.id, layerId)!;
    expect(projected).toMatchObject({ editable: true, sourceKind: 'flow',
      content: { totalLength: 5_000, truncated: true } });
    expect(projected.content.text).toHaveLength(4_096);
    expect(JSON.stringify(projected)).not.toContain('byteLength');
    state.service.dispose(); state.workspace.dispose();
  });
});

describe('LightTableCommandService atomic batches', () => {
  it('publishes bounded document/session changes on a separate reconnect-safe cursor', () => {
    const state = setup();
    state.session.markChanged(4);
    state.session.history.record({ id: 'event-history', documentId: state.session.id,
      type: 'automation.batch', label: 'Agent edit', undo: () => undefined, redo: () => undefined });
    const generation = state.session.renderer.beginStart();
    state.session.renderer.markReady(generation);
    const result = state.service.queryPublicationEvents(0, 20);
    expect(result).toMatchObject({ gap: false, hasMore: false,
      latestCursor: result.cursor });
    expect(result.events.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      'document-revision-changed', 'history-changed', 'renderer-changed'
    ]));
    expect(state.service.queryPublicationEvents(result.cursor, 20).events).toEqual([]);
    state.service.dispose(); state.workspace.dispose();
  });

  it('accepts one bounded task and exposes reconnect-safe progress events', async () => {
    const state = setup();
    vi.mocked(state.ports.executeAtomicBatch).mockImplementation(async (_documentId, batch, _signal, report) => {
      report(1, batch.operations[0].operationId);
      return { operationIds: batch.operations.map(({ operationId }) => operationId) };
    });
    const result = await state.service.execute(request('command.batch', state.session.id, {
      name: 'Build mini design', operations: [
        { operationId: 'rename', command: 'layer.rename', parameters: { layerId: 'layer', name: 'Hero' } }
      ]
    }));
    expect(result.status).toBe('accepted');
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id,
      result.status === 'accepted' ? result.taskId : '')?.status).toBe('completed'));
    const events = state.service.queryTaskEvents(0, 20);
    expect(events.events.map(({ status }) => status)).toEqual(['queued', 'running', 'progress', 'completed']);
    expect(events.events[2]).toMatchObject({ operationId: 'rename', progress: 1 });
    state.service.dispose(); state.workspace.dispose();
  });

  it('cancels a running batch and rejects malformed batches before mutation', async () => {
    const state = setup();
    vi.mocked(state.ports.executeAtomicBatch).mockImplementation((_documentId, _batch, signal) => (
      new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('Canceled', 'AbortError')), { once: true }))
    ));
    const invalid = await state.service.execute(request('command.batch', state.session.id,
      { name: 'Bad', operations: [] }));
    expect(invalid).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.executeAtomicBatch).not.toHaveBeenCalled();
    const accepted = await state.service.execute(request('command.batch', state.session.id, {
      name: 'Cancelable', operations: [
        { operationId: 'rename', command: 'layer.rename', parameters: { layerId: 'layer', name: 'Hero' } }
      ]
    }));
    if (accepted.status !== 'accepted') throw new Error('Batch was not accepted.');
    await Promise.resolve();
    expect(await state.service.execute(request('task.cancel', state.session.id,
      { taskId: accepted.taskId }))).toMatchObject({ status: 'completed' });
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId)?.status).toBe('canceled'));
    state.service.dispose(); state.workspace.dispose();
  });

  it('times out a batch without publishing a completed event', async () => {
    const state = setup();
    vi.mocked(state.ports.executeAtomicBatch).mockImplementation((_documentId, _batch, signal) => (
      new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('Timed out', 'AbortError')), { once: true }))
    ));
    const accepted = await state.service.execute(request('command.batch', state.session.id, {
      name: 'Timeout', timeoutMs: 100, operations: [
        { operationId: 'rename', command: 'layer.rename', parameters: { layerId: 'layer', name: 'Hero' } }
      ]
    }));
    if (accepted.status !== 'accepted') throw new Error('Batch was not accepted.');
    await vi.waitFor(() => expect(state.service.queryTask(state.session.id, accepted.taskId)?.status).toBe('canceled'),
      { timeout: 1000 });
    expect(state.service.queryTaskEvents().events.some(({ status }) => status === 'completed')).toBe(false);
    state.service.dispose(); state.workspace.dispose();
  });
});

describe('LightTableCommandService registry', () => {
  it('routes Image Size through the mounted document command port', async () => {
    const state = setup();
    const parameters = {
      width: 40, height: 30, resolutionPpi: 300, resample: true,
      method: 'automatic', preserveDetailsNoiseReduction: 0, scaleStyles: true
    };
    const result = await state.service.execute(request(
      'document.resizeImage', state.session.id, parameters
    ));
    expect(result).toMatchObject({ status: 'completed', value: { width: 40, height: 30, resolutionPpi: 300 } });
    expect(state.ports.resizeImage).toHaveBeenCalledWith(state.session.id, parameters);
    state.service.dispose(); state.workspace.dispose();
  });

  it('routes canonical document geometry through the mounted document port', async () => {
    const state = setup();
    const parameters = { operation: 'canvas-size', width: 100, height: 90, anchorX: 0.5, anchorY: 1 };
    const result = await state.service.execute(request('document.applyGeometry', state.session.id, parameters));
    expect(result).toMatchObject({ status: 'completed', value: { operation: 'canvas-size' } });
    expect(state.ports.applyDocumentGeometry).toHaveBeenCalledWith(state.session.id, parameters);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes semantic vector and Layer Style mutations', async () => {
    const state = setup();
    vi.mocked(state.ports.executeVectorCommand).mockResolvedValue({ layerId: 'vector', elementId: 'shape' });
    vi.mocked(state.ports.executeLayerStyleCommand).mockResolvedValue({ layerId: 'layer', effectId: 'effect' });
    const vector = await state.service.execute(request('vector.create', state.session.id, {
      primitive: { kind: 'ellipse', x: 10, y: 20, width: 80, height: 40 },
      style: { fill: null }
    }));
    const effect = await state.service.execute(request('layer.effect.add', state.session.id, {
      layerId: state.session.getSnapshot().document!.activeLayerId, effectKind: 'drop-shadow',
      settings: { distance: 12, size: 8 }
    }));
    expect(vector.status).toBe('completed'); expect(effect.status).toBe('completed');
    expect(state.ports.executeVectorCommand).toHaveBeenCalledOnce();
    expect(state.ports.executeLayerStyleCommand).toHaveBeenCalledOnce();
    const malformed = await state.service.execute(request('vector.create', state.session.id, {
      primitive: { kind: 'ellipse', x: 0, y: 0, width: Number.NaN, height: 10 }
    }));
    expect(malformed).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes one bounded semantic Warp recipe', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    vi.mocked(state.ports.executeWarpStrokeCommand!).mockResolvedValue({
      layerId, strokeId: 'warp-stroke', sampleCount: 1
    });
    const result = await state.service.execute(request(
      'warp.applyStroke', state.session.id, warpStroke(layerId)
    ));
    expect(result).toMatchObject({ status: 'completed', value: {
      layerId, strokeId: 'warp-stroke', sampleCount: 1
    } });
    expect(state.ports.executeWarpStrokeCommand).toHaveBeenCalledOnce();
    const invalid = await state.service.execute(request('warp.applyStroke', state.session.id, {
      ...warpStroke(layerId), samples: []
    }));
    expect(invalid).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes one explicit semantic Fill operation', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    vi.mocked(state.ports.executeFillCommand!).mockResolvedValue({ layerId, channel: 'pixels' });
    const result = await state.service.execute(request('raster.fill', state.session.id, {
      layerId, channel: 'pixels', color: '#2F80ED', preserveTransparency: false, opacity: 1
    }));
    expect(result).toMatchObject({ status: 'completed', value: { layerId, channel: 'pixels' } });
    expect(state.ports.executeFillCommand).toHaveBeenCalledWith(state.session.id,
      expect.objectContaining({ layerId, color: '#2f80ed', opacity: 1 }));
    expect(await state.service.execute(request('raster.fill', state.session.id, {
      layerId, channel: 'pixels', color: 'blue', opacity: 1
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes one final raster-gradient paint', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    vi.mocked(state.ports.executeRasterGradientCommand!).mockResolvedValue({ layerId, channel: 'pixels' });
    const result = await state.service.execute(request(
      'raster.applyGradient', state.session.id, rasterGradient(layerId)
    ));
    expect(result).toMatchObject({ status: 'completed', value: { layerId, channel: 'pixels' } });
    expect(state.ports.executeRasterGradientCommand).toHaveBeenCalledWith(state.session.id,
      expect.objectContaining({ layerId, opacity: 0.8,
        paint: expect.objectContaining({ coordinateSpace: 'document' }) }));
    const oversized = rasterGradient(layerId);
    oversized.paint.asset.name = 'x'.repeat(70 * 1024);
    expect(await state.service.execute(request('raster.applyGradient', state.session.id, oversized)))
      .toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes canonical Face Warp operations', async () => {
    const state = setup();
    vi.mocked(state.ports.executeFaceWarpCommand!).mockResolvedValue({
      layerId: 'portrait', faceId: 'face-1', operation: 'set-semantic'
    });
    const result = await state.service.execute(request('faceWarp.applyOperation', state.session.id, {
      layerId: 'portrait', operation: {
        kind: 'set-semantic', faceId: 'face-1', target: 'right', change: { eyeSize: 0.4 }
      }
    }));
    expect(result).toMatchObject({ status: 'completed', value: {
      layerId: 'portrait', faceId: 'face-1', operation: 'set-semantic'
    } });
    expect(state.ports.executeFaceWarpCommand).toHaveBeenCalledWith(state.session.id,
      expect.objectContaining({ operation: expect.objectContaining({ target: 'right' }) }));
    expect(await state.service.execute(request('faceWarp.applyOperation', state.session.id, {
      layerId: 'portrait', operation: {
        kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { smile: 3 }
      }
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes structural layer capabilities with stable targets', async () => {
    const state = setup();
    vi.mocked(state.ports.executeLayerCommand).mockImplementation((_documentId, command) => {
      if (command.kind === 'duplicate') return { sourceLayerId: command.layerId, layerId: 'copy-id' };
      if (command.kind === 'delete') return { layerIds: command.layerIds };
      if (command.kind === 'move') return { layerId: command.layerId, direction: command.direction };
      if (command.kind === 'set-blend-mode') return { layerId: command.layerId, blendMode: command.blendMode };
      if (command.kind === 'set-clipping') return { layerId: command.layerId, clipping: command.clipping };
      if (command.kind === 'set-lock') return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
      if (command.kind === 'set-mask') return { layerId: command.layerId, operation: command.operation,
        ...(command.operation === 'add' ? { source: command.source ?? 'reveal-all' } : {}),
        ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
        ...(command.operation === 'set-linked' ? { linked: command.linked } : {}) };
      return null;
    });
    const document = state.session.getSnapshot().document!;
    const topId = document.activeLayerId!;
    const results = await Promise.all([
      state.service.execute(request('layer.duplicate', state.session.id, { layerId: topId })),
      state.service.execute(request('layer.move', state.session.id, { layerId: topId, direction: 'down' })),
      state.service.execute(request('layer.setBlendMode', state.session.id,
        { layerId: topId, blendMode: 'screen' })),
      state.service.execute(request('layer.setClipping', state.session.id,
        { layerId: topId, clipping: true })),
      state.service.execute(request('layer.setMask', state.session.id,
        { layerId: topId, operation: 'add', source: 'reveal-all' })),
      state.service.execute(request('layer.setLock', state.session.id,
        { layerIds: [topId], lock: 'position', locked: true })),
      state.service.execute(request('layer.delete', state.session.id, { layerIds: [topId] }))
    ]);
    expect(results.every(({ status }) => status === 'completed')).toBe(true);
    for (const [index, command] of ([
      'layer.duplicate', 'layer.move', 'layer.setBlendMode', 'layer.setClipping',
      'layer.setMask', 'layer.setLock', 'layer.delete'
    ] as const).entries()) {
      if (!command || results[index]?.status !== 'completed') continue;
      expect(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS[command]!.result,
        results[index].value).valid).toBe(true);
    }
    expect(state.ports.executeLayerCommand).toHaveBeenCalledTimes(7);

    const malformed = await state.service.execute(request('layer.setBlendMode', state.session.id,
      { layerId: topId, blendMode: 'unknown-mode' }));
    const missing = await state.service.execute(request('layer.delete', state.session.id,
      { layerIds: ['missing-layer'] }));
    expect(malformed).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(missing).toMatchObject({ status: 'rejected', code: 'command-unavailable' });
    const invalidMask = await state.service.execute(request('layer.setMask', state.session.id,
      { layerId: topId, operation: 'set-enabled' }));
    expect(invalidMask).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.executeLayerCommand).toHaveBeenCalledTimes(7);
    state.service.dispose(); state.workspace.dispose();
  });

  it('routes mounted document controllers and rejects calls after unmount', async () => {
    const registry = new LightTableCommandPortRegistry();
    const ports = {
      setZoom: vi.fn(),
      createRasterLayer: vi.fn(),
      placeArtifact: vi.fn(),
      renameLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
      setLayerFillOpacity: vi.fn(),
      setLayerStyleEnabled: vi.fn(),
      setLayerEffectEnabled: vi.fn(),
      executeTextCommand: vi.fn(),
      executeVectorCommand: vi.fn(),
      executeLayerStyleCommand: vi.fn(),
      executeLayerCommand: vi.fn(),
      executeAtomicBatch: vi.fn(),
      exportNativeArtifact: vi.fn(async () => new File(['native'], 'test.lighttable')),
      exportPngArtifact: vi.fn(async () => new File(['png'], 'test.png', { type: 'image/png' })),
      exportPreviewArtifact: vi.fn(async (maxEdge: number) =>
        new File(['preview'], `preview-${maxEdge}.png`, { type: 'image/png' })),
      exportLayerPreviewArtifact: vi.fn(async () => ({
        file: new File(['layer'], 'layer.png', { type: 'image/png' }), width: 40, height: 30,
        sourceToOutput: { a: 0.5, b: 0, c: 0, d: 0.5, tx: 0, ty: 0 }
      })),
      exportPsdArtifact: vi.fn(async () => new File(['psd'], 'test.psd', { type: 'image/vnd.adobe.photoshop' })),
      beginGesture: vi.fn(async () => true),
      updateGesture: vi.fn(async () => true),
      finishGesture: vi.fn(async () => true),
      undo: vi.fn(async () => true),
      redo: vi.fn(async () => true)
    };
    const unregister = registry.register('document-mounted' as never, ports);

    await registry.setZoom('document-mounted' as never, {
      zoomMode: 'custom',
      scale: 2,
      panX: 4,
      panY: 8
    });
    expect(ports.setZoom).toHaveBeenCalledWith(expect.objectContaining({ scale: 2 }));

    unregister();
    expect(() => registry.createRasterLayer('document-mounted' as never)).toThrow(
      'command controller is not mounted'
    );
  });

  it('validates and executes the zoom vertical slice through an injected controller', async () => {
    const state = setup();
    const result = await state.service.execute(request(
      'view.setZoom',
      state.session.id,
      { mode: 'custom', percent: 250 }
    ));
    expect(result).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(state.ports.setZoom).toHaveBeenCalledWith(
      state.session.id,
      expect.objectContaining({ zoomMode: 'custom', scale: 2.5 })
    );
    expect(state.session.getSnapshot().viewport.scale).toBe(2.5);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects stale revisions before invoking a mutation port', async () => {
    const state = setup();
    const result = await state.service.execute({
      ...request('layer.createRaster', state.session.id),
      expectedDocumentRevision: 99
    });
    expect(result).toEqual(expect.objectContaining({
      status: 'rejected',
      code: 'stale-document-revision'
    }));
    expect(state.ports.createRasterLayer).not.toHaveBeenCalled();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('advances the canonical revision after semantic mutations and committed gestures', async () => {
    const state = setup();
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(0);
    await state.service.execute(request('layer.createRaster', state.session.id));
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(1);
    const started = await state.service.beginGesture({ documentId: state.session.id,
      kind: 'brush-stroke', coordinateSpace: 'document', parameters: {},
      sample: { x: 1, y: 1 } });
    expect(started.status).toBe('started');
    if (started.status === 'started' && started.gestureId) {
      await state.service.finishGesture(started.gestureId, true);
    }
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(2);
    const selection = await state.service.beginGesture({ documentId: state.session.id,
      kind: 'selection-rectangle', coordinateSpace: 'document', parameters: { mode: 'replace' },
      sample: { x: 0, y: 0 } });
    if (selection.status === 'started' && selection.gestureId) {
      await state.service.finishGesture(selection.gestureId, true);
    }
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(2);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('records and replays one bounded committed tool operation instead of pointer commands', async () => {
    const state = setup();
    const samples = Array.from({ length: 2048 }, (_, index) => ({
      x: index, y: index * 0.5, pressure: 0.75
    }));
    state.service.startActionRecording('One stroke');
    const result = await state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke',
      parameters: { layerId: state.session.getSnapshot().document!.activeLayerId,
        channel: 'pixels', brush: automationBrush },
      samples
    }));
    state.service.stopActionRecording();
    expect(result).toMatchObject({ status: 'completed', value: {
      kind: 'brush-stroke', sampleCount: 2048
    } });
    expect(state.ports.beginGesture).toHaveBeenCalledTimes(1);
    expect(state.ports.updateGesture).toHaveBeenCalledTimes(2047);
    expect(state.ports.finishGesture).toHaveBeenCalledTimes(1);
    const recording = state.service.actionRecordingSnapshot();
    expect(recording.steps).toMatchObject([
      { command: 'tool.commitGesture', replayable: true,
        parameters: { kind: 'brush-stroke', samples } }
    ]);
    expect(recording.steps).toHaveLength(1);
    expect(recording.byteLength).toBeGreaterThan(0);
    expect(recording.byteLength).toBeLessThanOrEqual(220 * 1024);

    await state.service.playActionRecording();
    expect(state.ports.beginGesture).toHaveBeenCalledTimes(2);
    expect(state.ports.updateGesture).toHaveBeenCalledTimes(4094);
    expect(state.ports.finishGesture).toHaveBeenCalledTimes(2);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates, records and replays one contextual fixed transform', async () => {
    const state = setup();
    vi.mocked(state.ports.executeFixedTransform!).mockImplementation((_documentId, command) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return { operation: command.operation, target: 'layer' };
    });
    state.service.startActionRecording('Flip current target');
    const result = await state.service.execute(request('transform.applyFixed', state.session.id, {
      operation: 'flip-horizontal'
    }));
    state.service.stopActionRecording();

    expect(result).toMatchObject({ status: 'completed', value: {
      operation: 'flip-horizontal', target: 'layer'
    } });
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'transform.applyFixed', replayable: true,
      parameters: { operation: 'flip-horizontal' }
    }]);

    await state.service.playActionRecording();
    expect(state.ports.executeFixedTransform).toHaveBeenCalledTimes(2);
    expect(await state.service.execute(request('transform.applyFixed', state.session.id, {
      operation: 'rotate-45'
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.executeFixedTransform).toHaveBeenCalledTimes(2);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates, records and replays explicit adjustment creation targets', async () => {
    const state = setup();
    vi.mocked(state.ports.executeAdjustmentCreation!).mockImplementation((_documentId, command) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return { ...command, adjustmentId: 'adjustment-created' };
    });
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    state.service.startActionRecording('Attach Threshold');
    const result = await state.service.execute(request('adjustment.create', state.session.id, {
      kind: 'threshold', placement: 'attached', layerId
    }));
    state.service.stopActionRecording();

    expect(result).toMatchObject({ status: 'completed', value: {
      kind: 'threshold', placement: 'attached', layerId,
      adjustmentId: 'adjustment-created'
    } });
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'adjustment.create', replayable: true,
      parameters: { kind: 'threshold', placement: 'attached', layerId }
    }]);
    await state.service.playActionRecording();
    expect(state.ports.executeAdjustmentCreation).toHaveBeenCalledTimes(2);

    expect(await state.service.execute(request('adjustment.create', state.session.id, {
      kind: 'threshold', placement: 'attached', layerId: 'missing'
    }))).toMatchObject({ status: 'rejected', code: 'command-unavailable' });
    expect(await state.service.execute(request('adjustment.create', state.session.id, {
      kind: 'threshold', placement: 'local', layerId
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.executeAdjustmentCreation).toHaveBeenCalledTimes(2);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates, records and replays explicit raster inversion', async () => {
    const state = setup();
    vi.mocked(state.ports.executeRasterInvert!).mockImplementation((_documentId, command) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return command;
    });
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    state.service.startActionRecording('Invert photo');
    const result = await state.service.execute(request('raster.invert', state.session.id,
      { layerId, channel: 'pixels' }));
    state.service.stopActionRecording();
    expect(result).toMatchObject({ status: 'completed', value: { layerId, channel: 'pixels' } });
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'raster.invert', replayable: true, parameters: { layerId, channel: 'pixels' }
    }]);
    await state.service.playActionRecording();
    expect(state.ports.executeRasterInvert).toHaveBeenCalledTimes(2);
    expect(await state.service.execute(request('raster.invert', state.session.id,
      { layerId, channel: 'all' }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it.each([
    ['text.convertToShape', 'executeTextToShape', 'vector'],
    ['text.rasterize', 'executeTextRasterize', 'raster']
  ] as const)('validates, records and replays %s with a stable text-layer target', async (
    commandId, portName, outputType
  ) => {
    const state = setup();
    const textDocument = createTextLayer(
      state.session.getSnapshot().document!, createDefaultTextLayerData(), 'Editable text'
    );
    state.session.setDocument(textDocument);
    const layerId = textDocument.activeLayerId!;
    vi.mocked(state.ports[portName]!).mockImplementation((_documentId, command) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return { layerId: command.layerId, outputType };
    });
    state.service.startActionRecording(`Finalize ${outputType} text`);
    const result = await state.service.execute(request(commandId, state.session.id, { layerId }));
    state.service.stopActionRecording();

    expect(result).toMatchObject({ status: 'completed', value: { layerId, outputType } });
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: commandId, replayable: true, parameters: { layerId }
    }]);
    await state.service.playActionRecording();
    expect(state.ports[portName]).toHaveBeenCalledTimes(2);
    expect(await state.service.execute(request(commandId, state.session.id, {
      layerId, unexpected: true
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('records and replays an explicit contiguous layer merge', async () => {
    const state = setup();
    const withSecond = createRasterLayer(state.session.getSnapshot().document!, 'Second');
    state.session.setDocument(withSecond);
    const layerIds = withSecond.layers.map(({ id }) => id);
    vi.mocked(state.ports.executeLayerMerge!).mockImplementation((_documentId, command) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return { layerIds: command.layerIds, outputLayerId: 'merged-output' };
    });
    state.service.startActionRecording('Merge title layers');
    const result = await state.service.execute(request('layer.merge', state.session.id, { layerIds }));
    state.service.stopActionRecording();

    expect(result).toMatchObject({ status: 'completed', value: {
      layerIds, outputLayerId: 'merged-output'
    } });
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'layer.merge', parameters: { layerIds }, replayable: true
    }]);
    await state.service.playActionRecording();
    expect(state.ports.executeLayerMerge).toHaveBeenCalledTimes(2);
    expect(await state.service.execute(request('layer.merge', state.session.id, {
      layerIds: [layerIds[0], layerIds[0]]
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('records and replays explicit group and image flatten targets', async () => {
    const state = setup();
    const twoLayers = createRasterLayer(state.session.getSnapshot().document!, 'Second');
    const grouped = groupLayers(twoLayers, twoLayers.layers.map(({ id }) => id), 'Card');
    state.session.setDocument(grouped);
    const groupId = grouped.activeLayerId!;
    const mutate = (value: unknown) => {
      const current = state.session.getSnapshot().document!;
      state.session.setDocument({ ...current, revision: current.revision + 1 });
      return value;
    };
    vi.mocked(state.ports.executeFlattenGroup!).mockImplementation((_documentId, command) => (
      mutate({ groupId: command.groupId, outputLayerId: 'group-output' })
    ));
    vi.mocked(state.ports.executeFlattenImage!).mockImplementation(() => (
      mutate({ outputLayerId: 'image-output' })
    ));
    state.service.startActionRecording('Flatten card');
    expect(await state.service.execute(request('layer.flattenGroup', state.session.id, { groupId })))
      .toMatchObject({ status: 'completed', value: { groupId, outputLayerId: 'group-output' } });
    state.service.stopActionRecording();
    await state.service.playActionRecording();
    expect(state.ports.executeFlattenGroup).toHaveBeenCalledTimes(2);

    expect(await state.service.execute(request('document.flattenImage', state.session.id, {})))
      .toMatchObject({ status: 'completed', value: { outputLayerId: 'image-output' } });
    expect(await state.service.execute(request('document.flattenImage', state.session.id,
      { preserveLayers: true }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('rejects oversized committed tool operations before touching the editor hot path', async () => {
    const state = setup();
    const result = await state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke', parameters: {},
      samples: Array.from({ length: 4097 }, (_, index) => ({ x: index, y: 0 }))
    }));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.beginGesture).not.toHaveBeenCalled();
    state.service.dispose(); state.workspace.dispose();
  });

  it('accepts bounded tone-brush operators and rejects malformed operator settings', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId;
    const valid = await state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke',
      parameters: { layerId, channel: 'pixels', brush: automationBrush, operator: {
        operator: 'tone', mode: 'dodge', range: 'highlights', spongeMode: 'saturate',
        protectTones: true, vibrance: true
      } },
      samples: [{ x: 4, y: 5, pressure: 1 }, { x: 8, y: 9, pressure: 0.5 }]
    }));
    expect(valid).toMatchObject({ status: 'completed' });
    expect(state.ports.beginGesture).toHaveBeenCalledWith(
      state.session.id, 'brush-stroke', expect.any(Number),
      expect.objectContaining({ operator: expect.objectContaining({ mode: 'dodge' }) }),
      expect.objectContaining({ x: 4, y: 5 })
    );

    const malformed = await state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke',
      parameters: { layerId, channel: 'pixels', brush: automationBrush, operator: {
        operator: 'tone', mode: 'blur', range: 'highlights', spongeMode: 'saturate',
        protectTones: true, vibrance: true
      } },
      samples: [{ x: 4, y: 5 }]
    }));
    expect(malformed).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('accepts document-relative sampled-brush sources without nested document identity', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId;
    const operator = {
      operator: 'healing', source: { anchorLayerId: layerId, point: { x: 20, y: 30 } },
      sampleMode: 'current-and-below', sourceOffset: { x: -40, y: 10 }, diffusion: 5
    };
    await expect(state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', brush: automationBrush, operator },
      samples: [{ x: 60, y: 20, pressure: 1 }, { x: 80, y: 25, pressure: 0.8 }]
    }))).resolves.toMatchObject({ status: 'completed' });
    expect(state.ports.beginGesture).toHaveBeenCalledWith(
      state.session.id, 'brush-stroke', expect.any(Number),
      expect.objectContaining({ operator }), expect.any(Object)
    );

    await expect(state.service.execute(request('tool.commitGesture', state.session.id, {
      kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', brush: automationBrush,
        operator: { ...operator, source: { ...operator.source, documentId: state.session.id } } },
      samples: [{ x: 60, y: 20 }]
    }))).resolves.toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('routes a final selection shape without changing the document revision', async () => {
    const executeSelectionCommand = vi.fn(async (_documentId, command) => command.kind === 'apply-shape'
      ? { mode: command.mode, shape: command.shape,
        featherRadius: command.featherRadius, antiAlias: command.antiAlias }
      : null);
    const state = setup({ executeSelectionCommand });
    const before = state.service.queryDocument(state.session.id)!.canonicalRevision;
    await expect(state.service.execute(request('selection.applyShape', state.session.id, {
      mode: 'replace',
      shape: { kind: 'rectangle', points: [{ x: 10, y: 20 }, { x: 80, y: 90 }] },
      featherRadius: 2,
      antiAlias: true
    }))).resolves.toMatchObject({ status: 'completed' });
    expect(executeSelectionCommand).toHaveBeenCalledOnce();
    expect(state.service.queryDocument(state.session.id)!.canonicalRevision).toBe(before);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates, records and replays one asynchronous Magic Wand recipe', async () => {
    const executeSelectionCommand = vi.fn(async (_documentId, command) => command.kind === 'magic-wand'
      ? { layerId: command.layerId, point: command.point,
        mode: command.mode, options: command.options }
      : null);
    const state = setup({ executeSelectionCommand });
    const layerId = state.session.getSnapshot().document!.activeLayerId;
    const parameters = {
      kind: 'magic-wand', layerId, point: { x: 24, y: 18 }, mode: 'replace',
      options: { sampleSize: 3, tolerance: 20, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    };
    state.service.startActionRecording('Select sampled region');
    await expect(state.service.execute(request(
      'selection.applyMagicWand', state.session.id, parameters
    ))).resolves.toMatchObject({ status: 'completed' });
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'selection.applyMagicWand', replayable: true, parameters
    }]);
    await state.service.playActionRecording();
    expect(executeSelectionCommand).toHaveBeenCalledTimes(2);
    await expect(state.service.execute(request('selection.applyMagicWand', state.session.id, {
      ...parameters, options: { ...parameters.options, sampleSize: 7 }
    }))).resolves.toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('records and replays a discrete selection modification without document mutation', async () => {
    const executeSelectionCommand = vi.fn(async () => ({ operation: 'invert' }));
    const state = setup({ executeSelectionCommand });
    const before = state.service.queryDocument(state.session.id)!.canonicalRevision;
    state.service.startActionRecording('Invert selection');
    await expect(state.service.execute(request('selection.modify', state.session.id, {
      kind: 'modify', operation: 'invert'
    }))).resolves.toMatchObject({ status: 'completed' });
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'selection.modify', replayable: true,
      parameters: { kind: 'modify', operation: 'invert' }
    }]);
    expect(state.service.queryDocument(state.session.id)!.canonicalRevision).toBe(before);
    await state.service.playActionRecording();
    expect(executeSelectionCommand).toHaveBeenCalledTimes(2);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('validates, records and replays a bounded selection feather', async () => {
    const executeSelectionCommand = vi.fn(async (_documentId, command) => ({
      operation: command.kind === 'modify' ? command.operation : command.kind,
      ...command.kind === 'modify' && command.operation === 'feather'
        ? { radius: command.radius } : {}
    }));
    const state = setup({ executeSelectionCommand });
    const parameters = { kind: 'modify', operation: 'feather', radius: 14 };
    state.service.startActionRecording('Feather selection');
    await expect(state.service.execute(request('selection.modify', state.session.id, parameters)))
      .resolves.toMatchObject({ status: 'completed', value: { operation: 'feather', radius: 14 } });
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'selection.modify', replayable: true, parameters
    }]);
    await state.service.playActionRecording();
    expect(executeSelectionCommand).toHaveBeenCalledTimes(2);
    await expect(state.service.execute(request('selection.modify', state.session.id, {
      kind: 'modify', operation: 'feather', radius: 251
    }))).resolves.toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates, records and replays one final basic Grade patch', async () => {
    const executeBasicAdjustmentCommand = vi.fn(async () => ({
      target: { kind: 'document' }, values: { exposureEV: 1.25 }, changed: true
    }));
    const state = setup({ executeBasicAdjustmentCommand });
    state.service.startActionRecording('Raise exposure');
    await expect(state.service.execute(request('grade.setBasic', state.session.id, {
      target: { kind: 'document' }, values: { exposureEV: 1.25 }
    }))).resolves.toMatchObject({ status: 'completed' });
    state.service.stopActionRecording();
    expect(state.service.actionRecordingSnapshot().steps).toMatchObject([{
      command: 'grade.setBasic', replayable: true,
      parameters: { target: { kind: 'document' }, values: { exposureEV: 1.25 } }
    }]);
    await state.service.playActionRecording();
    expect(executeBasicAdjustmentCommand).toHaveBeenCalledTimes(2);

    await expect(state.service.execute(request('grade.setBasic', state.session.id, {
      target: { kind: 'document' }, values: { exposureEV: 12 }
    }))).resolves.toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(executeBasicAdjustmentCommand).toHaveBeenCalledTimes(2);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('queries basic Grade state without changing history or Actions recording', () => {
    const queryBasicAdjustments = vi.fn((_documentId, target) => ({
      target, documentRevision: 3, targetRevision: 3, values: basicValues
    }));
    const state = setup({ queryBasicAdjustments });
    state.service.startActionRecording('Read only');
    const historyBefore = state.service.queryDocument(state.session.id)!.history;

    expect(state.service.queryBasicGrade(state.session.id, { kind: 'document' }))
      .toMatchObject({ target: { kind: 'document' }, values: { exposureEV: 0.75, vibrance: 12 } });
    expect(state.service.actionRecordingSnapshot().steps).toHaveLength(0);
    expect(state.service.queryDocument(state.session.id)!.history).toEqual(historyBefore);
    expect(() => state.service.queryBasicGrade(state.session.id, { kind: 'active-layer' }))
      .toThrow('document or one stable layerId');
    expect(queryBasicAdjustments).toHaveBeenCalledTimes(1);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('gates complete adjustment inspection on the canonical revision', () => {
    const queryAdjustments = vi.fn((_documentId, target) => ({
      status: 'completed' as const, documentId: 'document-1', documentRevision: 1,
      targetRevision: 1, target, adjustmentKind: 'grade',
      stack: { id: 'stack-1', revision: 0, totalModules: 0, truncated: false, modules: [] }
    }));
    const state = setup({ queryAdjustments });
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    expect(state.service.queryAdjustment(state.session.id, {
      expectedDocumentRevision: revision,
      target: { kind: 'document', owner: 'grade' }
    })).toMatchObject({ status: 'completed', adjustmentKind: 'grade' });
    expect(state.service.queryAdjustment(state.session.id, {
      expectedDocumentRevision: revision + 1,
      target: { kind: 'document', owner: 'grade' }
    })).toMatchObject({ status: 'rejected', code: 'stale-document-revision',
      currentRevision: revision });
    expect(queryAdjustments).toHaveBeenCalledTimes(1);
    state.service.dispose(); state.workspace.dispose();
  });

  it('validates bounded layer visibility mutations', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    expect(await state.service.execute(request(
      'layer.setVisibility',
      state.session.id,
      { layerIds: [layerId, layerId], visible: false }
    ))).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(state.ports.setLayerVisibility).toHaveBeenCalledWith(
      state.session.id,
      [layerId],
      false
    );
    expect(await state.service.execute(request(
      'layer.setVisibility',
      state.session.id,
      { layerIds: [], visible: false }
    ))).toEqual(expect.objectContaining({ status: 'rejected', code: 'invalid-parameters' }));
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects complete shared layer-schema violations before any mutation port runs', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    const invalid = [
      ['layer.rename', { layerId, name: '   ' }],
      ['layer.rename', { layerId, name: 'Hero', privateState: true }],
      ['layer.setVisibility', { layerIds: [], visible: true }],
      ['layer.setFillOpacity', { layerId, opacity: 1.01 }],
      ['layer.setBlendMode', { layerId, blendMode: 'not-a-mode' }],
      ['layer.setLock', { layerIds: [layerId], lock: 'position', locked: 'yes' }],
      ['layer.duplicate', { layerId, rendererState: {} }],
      ['layer.copyToNewLayer', { layerId: '' }],
      ['layer.delete', { layerIds: [] }],
      ['layer.move', { layerId, direction: 'left' }],
      ['layer.setClipping', { layerId, clipping: 1 }]
    ] as const;

    for (const [command, parameters] of invalid) {
      expect(await state.service.execute(request(command, state.session.id, parameters)))
        .toMatchObject({ status: 'rejected', code: 'invalid-parameters',
          message: expect.stringContaining('schema v1') });
    }
    expect(state.ports.renameLayer).not.toHaveBeenCalled();
    expect(state.ports.setLayerVisibility).not.toHaveBeenCalled();
    expect(state.ports.setLayerFillOpacity).not.toHaveBeenCalled();
    expect(state.ports.executeLayerCommand).not.toHaveBeenCalled();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('queries and toggles effect bypass through bounded document ports', async () => {
    const state = setup();
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    state.session.setDocument(addLayerStyle(state.session.getSnapshot().document!, layerId, 'drop-shadow'));
    const effect = state.session.getSnapshot().document!.layers
      .find(({ id }) => id === layerId)!.styleStack.effects[0]!;

    expect(state.service.queryLayerEffects(state.session.id, layerId)).toMatchObject({
      layerId, enabled: true,
      effects: [{
        id: effect.id,
        kind: 'drop-shadow',
        enabled: true,
        settings: { id: effect.id, kind: 'drop-shadow', distance: 30, size: 30 }
      }]
    });
    expect(await state.service.execute(request(
      'layer.effect.setEnabled', state.session.id,
      { layerId, effectId: effect.id, enabled: false }
    ))).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(state.ports.setLayerEffectEnabled).toHaveBeenCalledWith(
      state.session.id, layerId, effect.id, false
    );
    expect(await state.service.execute(request(
      'layer.style.setEnabled', state.session.id, { layerId, enabled: false }
    ))).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(state.ports.setLayerStyleEnabled).toHaveBeenCalledWith(
      state.session.id, layerId, false
    );
    expect(await state.service.execute(request(
      'layer.setFillOpacity', state.session.id, { layerId, opacity: 0.42 }
    ))).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(state.ports.setLayerFillOpacity).toHaveBeenCalledWith(
      state.session.id, layerId, 0.42
    );
    state.service.dispose();
    state.workspace.dispose();
  });

  it('returns task-backed opaque artifacts for native, PNG and PSD exports', async () => {
    const state = setup();
    for (const command of ['file.exportNative', 'file.exportPng', 'file.exportPsd'] as const) {
      const accepted = await state.service.execute(request(command, state.session.id, {}));
      expect(accepted.status).toBe('accepted');
      if (accepted.status !== 'accepted') continue;
      await vi.waitFor(() => expect(
        state.service.queryTask(state.session.id, accepted.taskId)?.status
      ).toBe('completed'));
      const artifact = state.service.queryTask(state.session.id, accepted.taskId)?.artifact;
      expect(artifact).toEqual(expect.objectContaining({ id: expect.any(String), byteLength: expect.any(Number) }));
      expect(state.service.queryArtifact(artifact!.id)).toEqual(artifact);
    }
    state.service.dispose();
    state.workspace.dispose();
  });

  it('serves revision-bound previews through the mounted thumbnail renderer and reuses them', async () => {
    const state = setup();
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    const request = { documentId: state.session.id,
      expectedDocumentRevision: revision, maxEdge: 512 };
    const first = await state.service.requestDocumentPreview(request);
    expect(first).toMatchObject({ status: 'completed', reused: false,
      artifact: { kind: 'render-preview', preview: {
        documentId: state.session.id, canonicalRevision: revision,
        width: 80, height: 60, maxEdge: 512
      } } });
    expect(state.ports.exportPreviewArtifact).toHaveBeenCalledWith(
      state.session.id, 512, { format: 'png' }, undefined
    );
    const second = await state.service.requestDocumentPreview(request);
    expect(second).toMatchObject({ status: 'completed', reused: true });
    expect(state.ports.exportPreviewArtifact).toHaveBeenCalledOnce();
    if (first.status !== 'completed') throw new Error('Expected preview artifact.');
    expect(state.service.releaseArtifact(first.artifact.id)).toBe(true);
    await expect(state.service.requestDocumentPreview(request)).resolves.toMatchObject({
      status: 'completed', reused: false
    });
    await expect(state.service.requestDocumentPreview({
      ...request, expectedDocumentRevision: revision + 1
    })).resolves.toMatchObject({ status: 'rejected', code: 'stale-document-revision',
      currentRevision: revision });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('serves isolated revision-bound layer pixels and invalidates their cache on release', async () => {
    const state = setup();
    const document = state.session.getSnapshot().document!;
    const layerId = document.activeLayerId!;
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    const request = { documentId: state.session.id, layerId, channel: 'pixels',
      expectedDocumentRevision: revision, maxEdge: 256 };
    const first = await state.service.requestLayerPreview(request);
    expect(first).toMatchObject({ status: 'completed', reused: false,
      artifact: { preview: { documentId: state.session.id, canonicalRevision: revision,
        width: 40, height: 30, maxEdge: 256,
        target: { kind: 'layer', layerId, channel: 'pixels' } } } });
    expect(state.ports.exportLayerPreviewArtifact).toHaveBeenCalledWith(
      state.session.id, layerId, 'pixels', 256, { format: 'png' }
    );
    await expect(state.service.requestLayerPreview(request))
      .resolves.toMatchObject({ status: 'completed', reused: true });
    expect(state.ports.exportLayerPreviewArtifact).toHaveBeenCalledOnce();
    if (first.status !== 'completed') throw new Error('Expected layer preview artifact.');
    expect(state.service.releaseArtifact(first.artifact.id)).toBe(true);
    await expect(state.service.requestLayerPreview(request))
      .resolves.toMatchObject({ status: 'completed', reused: false });
    state.service.dispose(); state.workspace.dispose();
  });

  it('routes revision-bound document regions through the preview owner', async () => {
    const state = setup();
    const revision = state.service.queryDocument(state.session.id)!.canonicalRevision;
    const region = { x: 10, y: 5, width: 40, height: 20 };
    const result = await state.service.requestDocumentPreview({ documentId: state.session.id,
      expectedDocumentRevision: revision, maxEdge: 20, region });
    // Agent previews intentionally reject edges below 64 before reaching the renderer.
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid-request' });
    const completed = await state.service.requestDocumentPreview({ documentId: state.session.id,
      expectedDocumentRevision: revision, maxEdge: 64, region });
    expect(completed).toMatchObject({ status: 'completed', artifact: { preview: {
      width: 40, height: 20, target: { kind: 'region', bounds: region }
    } } });
    expect(state.ports.exportPreviewArtifact).toHaveBeenCalledWith(
      state.session.id, 64, { format: 'png' }, region
    );
    state.service.dispose(); state.workspace.dispose();
  });

  it('retains successful PSD compatibility findings on the opaque artifact', async () => {
    const state = setup();
    state.ports.exportPsdArtifact = vi.fn(async () => ({
      file: new File(['psd'], 'degraded.psd', { type: 'image/vnd.adobe.photoshop' }),
      findings: [{
        severity: 'degraded-editability' as const,
        code: 'face-warp-baked' as const,
        path: 'layers[0]',
        message: 'Face Warp was baked.'
      }],
      warnings: ['layers[0]: Face Warp was baked.'],
      editableTextLayers: 0,
      editableVectorLayers: 0
    }));

    const accepted = await state.service.execute(request(
      'file.exportPsd', state.session.id, {}
    ));
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') throw new Error('Expected an export task.');
    await vi.waitFor(() => expect(
      state.service.queryTask(state.session.id, accepted.taskId)?.status
    ).toBe('completed'));

    expect(state.service.queryTask(state.session.id, accepted.taskId)?.artifact)
      .toMatchObject({
        kind: 'psd-export',
        compatibilityFindings: [{
          severity: 'degraded-editability',
          code: 'face-warp-baked',
          path: 'layers[0]'
        }]
      });
    state.service.dispose();
    state.workspace.dispose();
  });

  it('opens registered input artifacts through the explicit workspace host port', async () => {
    const state = setup();
    const openArtifact = vi.fn(async () => state.session.id);
    const service = new LightTableCommandService(
      state.workspace, state.ports, {
        openArtifact,
        createDocument: vi.fn(async () => state.session.id),
        duplicateDocument: vi.fn(async () => state.session.id)
      }
    );
    const artifact = service.registerInputArtifact(new File(
      ['fixture'], 'fixture.psd', { type: 'image/vnd.adobe.photoshop' }
    ));
    const result = await service.execute({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId: 'open-artifact',
      command: 'file.openArtifact',
      parameters: { artifactId: artifact.id }
    });
    expect(result).toMatchObject({
      status: 'completed', value: { documentId: state.session.id }
    });
    expect(openArtifact).toHaveBeenCalledWith(expect.objectContaining({ name: 'fixture.psd' }));
    service.dispose();
    state.service.dispose();
    state.workspace.dispose();
  });

  it('creates a semantic document through the workspace port and rejects stale workspace state', async () => {
    const state = setup();
    const createDocument = vi.fn(async () => 'created-document' as never);
    const service = new LightTableCommandService(state.workspace, state.ports, {
      openArtifact: vi.fn(), createDocument,
      duplicateDocument: vi.fn(async () => state.session.id)
    });
    const parameters = { name: 'Poster', width: 1200, height: 800, resolutionPpi: 300,
      bitDepth: 16, profile: 'adobe-rgb-1998', background: { kind: 'solid', color: '#112233' } };
    const completed = await service.execute({
      protocolVersion: 1, requestId: 'create', command: 'document.create', parameters,
      expectedWorkspaceRevision: service.queryWorkspace().revision
    });
    expect(completed).toMatchObject({ status: 'completed', value: { documentId: 'created-document' } });
    expect(createDocument).toHaveBeenCalledWith(parameters);
    const stale = await service.execute({
      protocolVersion: 1, requestId: 'stale-create', command: 'document.create', parameters,
      expectedWorkspaceRevision: 999
    });
    expect(stale).toMatchObject({ status: 'rejected', code: 'stale-workspace-revision' });
    expect(createDocument).toHaveBeenCalledTimes(1);
    service.dispose(); state.service.dispose(); state.workspace.dispose();
  });

  it('duplicates a ready document through the workspace fork port without mutating its revision', async () => {
    const state = setup();
    const duplicateDocument = vi.fn(async () => 'duplicate-document' as never);
    const service = new LightTableCommandService(state.workspace, state.ports, {
      openArtifact: vi.fn(), createDocument: vi.fn(), duplicateDocument
    });
    const before = state.session.getSnapshot();
    const result = await service.execute(request('document.duplicate', state.session.id, {
      name: 'Source copy'
    }));
    expect(result).toMatchObject({ status: 'completed', value: { documentId: 'duplicate-document' } });
    expect(duplicateDocument).toHaveBeenCalledWith(state.session.id, 'Source copy');
    expect(state.session.getSnapshot().documentRevision).toBe(before.documentRevision);
    expect(state.session.getSnapshot().history.currentStateId).toBe(before.history.currentStateId);
    service.dispose(); state.service.dispose(); state.workspace.dispose();
  });

  it.each([
    ['image/png', 'placed.png'], ['image/jpeg', 'placed.jpg'], ['image/webp', 'placed.webp']
  ])('places a registered %s artifact through one document command', async (mediaType, name) => {
    const state = setup();
    const artifact = state.service.registerInputArtifact(new File(['pixels'], name, { type: mediaType }));
    state.ports.placeArtifact = vi.fn(async () => ({ layerId: 'layer-placed', width: 4, height: 3 }));
    const result = await state.service.execute(request('layer.placeArtifact', state.session.id, {
      artifactId: artifact.id, name: 'Placed asset', x: -12, y: 24
    }));
    expect(result).toMatchObject({ status: 'completed', value: { layerId: 'layer-placed' } });
    expect(state.ports.placeArtifact).toHaveBeenCalledWith(
      state.session.id, expect.objectContaining({ name }),
      { name: 'Placed asset', x: -12, y: 24 }
    );
    expect(state.service.queryDocument(state.session.id)?.canonicalRevision).toBe(1);
    state.service.dispose(); state.workspace.dispose();
  });

  it('rejects invalid document and placement resources without invoking mutation ports', async () => {
    const state = setup();
    const service = new LightTableCommandService(state.workspace, state.ports, {
      openArtifact: vi.fn(), createDocument: vi.fn(), duplicateDocument: vi.fn()
    });
    expect(await service.execute({ protocolVersion: 1, requestId: 'huge', command: 'document.create',
      parameters: { name: 'Huge', width: 32768, height: 32768, resolutionPpi: 72,
        bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' } } }))
      .toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    const artifact = service.registerInputArtifact(new File(['svg'], 'vector.svg', { type: 'image/svg+xml' }));
    expect(await service.execute(request('layer.placeArtifact', state.session.id, { artifactId: artifact.id })))
      .toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(await service.execute(request('layer.placeArtifact', state.session.id, {
      artifactId: artifact.id, pointerPosition: { x: 0, y: 0 }
    }))).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(await service.execute({ protocolVersion: 1, requestId: 'expanded-open',
      command: 'file.openArtifact', parameters: { artifactId: artifact.id, mode: 'place' } }))
      .toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.placeArtifact).not.toHaveBeenCalled();
    service.dispose(); state.service.dispose(); state.workspace.dispose();
  });

  it('validates and routes atomic semantic text commands with stale revision rejection', async () => {
    const state = setup();
    const base = state.session.getSnapshot().document!;
    const withText = createTextLayer(base, createDefaultTextLayerData(), 'Text');
    state.session.setDocument(withText);
    const layerId = withText.activeLayerId!;
    state.ports.executeTextCommand = vi.fn(async () => ({ layerId }));
    const result = await state.service.execute(request('text.replaceRange', state.session.id,
      { layerId, start: 0, end: 0, text: 'مرحبا 👋' }));
    expect(result).toMatchObject({ status: 'completed', value: { layerId } });
    expect(state.ports.executeTextCommand).toHaveBeenCalledWith(state.session.id,
      { kind: 'replace', layerId, start: 0, end: 0, text: 'مرحبا 👋' });
    const formatted = await state.service.execute(request('text.format', state.session.id,
      { layerId, style: { syntheticBold: true, syntheticItalic: true, underline: true } }));
    expect(formatted).toMatchObject({ status: 'completed' });
    expect(formatted.status === 'completed' && validateJsonSchemaValue(
      LIGHTTABLE_COMMAND_SCHEMAS['text.format']!.result, formatted.value
    ).valid).toBe(true);
    expect(state.ports.executeTextCommand).toHaveBeenLastCalledWith(state.session.id,
      { kind: 'format', layerId,
        style: { syntheticBold: true, syntheticItalic: true, underline: true } });
    const emptyFormat = await state.service.execute(request('text.format', state.session.id,
      { layerId, style: {} }));
    expect(emptyFormat).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    expect(state.ports.executeTextCommand).toHaveBeenCalledTimes(2);
    const stale = await state.service.execute({ ...request('text.format', state.session.id,
      { layerId, style: { fontSize: 64 } }), expectedDocumentRevision: 999 });
    expect(stale).toMatchObject({ status: 'rejected', code: 'stale-document-revision' });
    expect(state.ports.executeTextCommand).toHaveBeenCalledTimes(2);
    const invalid = await state.service.execute(request('text.replaceRange', state.session.id,
      { layerId, start: 0, end: 99, text: 'x' }));
    expect(invalid).toMatchObject({ status: 'rejected', code: 'invalid-parameters' });
    state.service.dispose(); state.workspace.dispose();
  });

  it('bounds document-coordinate gestures and commits through one owner', async () => {
    const state = setup();
    const started = await state.service.beginGesture({
      documentId: state.session.id,
      kind: 'selection-rectangle',
      coordinateSpace: 'document',
      parameters: { mode: 'replace' },
      sample: { x: 4, y: 5 }
    });
    expect(started).toEqual(expect.objectContaining({ status: 'started', sampleCount: 1 }));
    const duplicate = await state.service.beginGesture({
      documentId: state.session.id,
      kind: 'brush-stroke', coordinateSpace: 'document', parameters: {}, sample: { x: 1, y: 1 }
    });
    expect(duplicate.status).toBe('rejected');
    const updated = await state.service.updateGesture(started.gestureId!, [
      { x: 10, y: 11, pressure: 0.5 }, { x: 12, y: 13 }
    ]);
    expect(updated).toEqual(expect.objectContaining({ status: 'updated', sampleCount: 3 }));
    expect(await state.service.finishGesture(started.gestureId!, true))
      .toEqual(expect.objectContaining({ status: 'completed', sampleCount: 3 }));
    expect(state.ports.finishGesture).toHaveBeenCalledTimes(1);
    state.service.dispose();
    state.workspace.dispose();
  });

  it('leases live gestures and releases the document after timeout', async () => {
    vi.useFakeTimers();
    try {
      const state = setup();
      const started = await state.service.beginGesture({
        documentId: state.session.id, kind: 'selection-rectangle',
        coordinateSpace: 'document', parameters: { mode: 'replace' },
        sample: { x: 4, y: 5 }
      });
      expect(started.status).toBe('started');
      await vi.advanceTimersByTimeAsync(30_001);
      expect(state.ports.finishGesture).toHaveBeenCalledWith(
        state.session.id, 'selection-rectangle', expect.any(Number), false
      );
      await expect(state.service.beginGesture({
        documentId: state.session.id, kind: 'selection-rectangle',
        coordinateSpace: 'document', parameters: { mode: 'replace' },
        sample: { x: 8, y: 9 }
      })).resolves.toMatchObject({ status: 'started' });
      state.service.dispose();
      state.workspace.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes a lease after accepted samples and cancels on document close', async () => {
    vi.useFakeTimers();
    try {
      const state = setup();
      const started = await state.service.beginGesture({
        documentId: state.session.id, kind: 'selection-rectangle',
        coordinateSpace: 'document', parameters: { mode: 'replace' },
        sample: { x: 1, y: 1 }
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await state.service.updateGesture(started.gestureId!, [{ x: 2, y: 2 }]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(state.ports.finishGesture).not.toHaveBeenCalled();

      expect(state.workspace.close(state.session.id, { discardChanges: true }).ok).toBe(true);
      await Promise.resolve();
      expect(state.ports.finishGesture).toHaveBeenCalledWith(
        state.session.id, 'selection-rectangle', expect.any(Number), false
      );
      expect(await state.service.cancelAllGestures()).toBe(0);
      state.service.dispose();
      state.workspace.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refresh leases for rejected updates and cancels during disposal', async () => {
    vi.useFakeTimers();
    try {
      const expired = setup();
      const started = await expired.service.beginGesture({
        documentId: expired.session.id, kind: 'selection-rectangle',
        coordinateSpace: 'document', parameters: { mode: 'replace' },
        sample: { x: 1, y: 1 }
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(expired.service.updateGesture(started.gestureId!, []))
        .resolves.toMatchObject({ status: 'rejected' });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(expired.ports.finishGesture).toHaveBeenCalledTimes(1);
      expired.service.dispose();
      expired.workspace.dispose();

      const disposed = setup();
      await disposed.service.beginGesture({
        documentId: disposed.session.id, kind: 'selection-rectangle',
        coordinateSpace: 'document', parameters: { mode: 'replace' },
        sample: { x: 3, y: 3 }
      });
      disposed.service.dispose();
      await Promise.resolve();
      expect(disposed.ports.finishGesture).toHaveBeenCalledWith(
        disposed.session.id, 'selection-rectangle', expect.any(Number), false
      );
      disposed.workspace.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed parameters and missing history capabilities consistently', async () => {
    const state = setup();
    expect(await state.service.execute(request(
      'layer.rename',
      state.session.id,
      { layerId: state.session.getSnapshot().document!.activeLayerId, name: '   ' }
    ))).toEqual(expect.objectContaining({ status: 'rejected', code: 'invalid-parameters' }));
    expect(await state.service.execute(request('history.undo', state.session.id))).toEqual(
      expect.objectContaining({
        status: 'rejected',
        code: 'command-unavailable',
        message: 'There is nothing to undo.'
      })
    );
    state.service.dispose();
    state.workspace.dispose();
  });

  it('rejects unknown commands and protocol versions without throwing', async () => {
    const state = setup();
    expect(await state.service.execute(request('internal.eval', state.session.id))).toEqual(
      expect.objectContaining({ status: 'rejected', code: 'unknown-command' })
    );
    expect(await state.service.execute({
      ...request('view.setZoom', state.session.id, { mode: 'fit' }),
      protocolVersion: 2
    })).toEqual(expect.objectContaining({ status: 'rejected', code: 'unsupported-protocol' }));
    state.service.dispose();
    state.workspace.dispose();
  });
});
