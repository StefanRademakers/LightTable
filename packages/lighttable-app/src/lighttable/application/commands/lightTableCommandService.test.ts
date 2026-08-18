import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer, createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { addLayerStyle } from '../../editor/styles/layerStyleCommands';
import { WorkspaceSession } from '../workspace/workspaceSession';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  LightTableCommandPortRegistry,
  LightTableCommandService,
  type LightTableCommandPorts
} from './lightTableCommandService';

const setup = () => {
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
    executeFaceWarpCommand: vi.fn(),
    executeAtomicBatch: vi.fn(),
    exportNativeArtifact: vi.fn(async () => new File(['native'], 'test.lighttable')),
    exportPngArtifact: vi.fn(async () => new File(['png'], 'test.png', { type: 'image/png' })),
    exportPsdArtifact: vi.fn(async () => new File(['psd'], 'test.psd', { type: 'image/vnd.adobe.photoshop' })),
    beginGesture: vi.fn(async () => true),
    updateGesture: vi.fn(async () => true),
    finishGesture: vi.fn(async () => true),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true)
  };
  const service = new LightTableCommandService(workspace, ports);
  return { workspace, session, ports, service };
};

const request = (command: string, documentId: string, parameters: unknown = {}) => ({
  protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  requestId: `request-${command}`,
  command,
  documentId,
  parameters
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
      executeAtomicBatch: vi.fn(),
      exportNativeArtifact: vi.fn(async () => new File(['native'], 'test.lighttable')),
      exportPngArtifact: vi.fn(async () => new File(['png'], 'test.png', { type: 'image/png' })),
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
    state.service.dispose();
    state.workspace.dispose();
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
    const stale = await state.service.execute({ ...request('text.format', state.session.id,
      { layerId, style: { fontSize: 64 } }), expectedDocumentRevision: 999 });
    expect(stale).toMatchObject({ status: 'rejected', code: 'stale-document-revision' });
    expect(state.ports.executeTextCommand).toHaveBeenCalledTimes(1);
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
