import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
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
    setZoom: vi.fn((_documentId, viewport) => session.updateViewport(() => viewport)),
    createRasterLayer: vi.fn(),
    renameLayer: vi.fn(),
    setLayerVisibility: vi.fn(),
    setLayerFillOpacity: vi.fn(),
    setLayerStyleEnabled: vi.fn(),
    setLayerEffectEnabled: vi.fn(),
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
});

describe('LightTableCommandService registry', () => {
  it('routes mounted document controllers and rejects calls after unmount', async () => {
    const registry = new LightTableCommandPortRegistry();
    const ports = {
      setZoom: vi.fn(),
      createRasterLayer: vi.fn(),
      renameLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
      setLayerFillOpacity: vi.fn(),
      setLayerStyleEnabled: vi.fn(),
      setLayerEffectEnabled: vi.fn(),
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
      state.workspace, state.ports, { openArtifact }
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
