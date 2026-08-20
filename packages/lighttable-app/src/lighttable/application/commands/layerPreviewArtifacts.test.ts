import { describe, expect, it, vi } from 'vitest';
import { LightTableArtifactRegistry } from './lightTableArtifactRegistry';
import { LayerPreviewArtifactController } from './layerPreviewArtifacts';

const create = () => {
  const registry = new LightTableArtifactRegistry();
  const state = { lifecycle: 'ready', canonicalRevision: 4, layerExists: true, hasMask: true };
  const render = vi.fn(async () => ({
    file: new File(['png'], 'layer.png', { type: 'image/png' }), width: 80, height: 60,
    sourceToOutput: { a: 0.5, b: 0, c: 0, d: 0.5, tx: -4, ty: 2 }
  }));
  const controller = new LayerPreviewArtifactController({
    snapshot: () => ({ ...state }), render,
    register: (file, context) => registry.registerPreview(file, context),
    query: (artifactId) => registry.query(artifactId)
  });
  return { controller, registry, render, state };
};

describe('LayerPreviewArtifactController', () => {
  it('caches the same revision, layer, channel and size and records exact mapping metadata', async () => {
    const state = create();
    const request = { documentId: 'document-1', layerId: 'layer-1', channel: 'pixels',
      expectedDocumentRevision: 4, maxEdge: 256 };
    const first = await state.controller.request(request);
    const second = await state.controller.request(request);
    expect(first).toMatchObject({ status: 'completed', reused: false,
      artifact: { preview: { width: 80, height: 60, target: { kind: 'layer',
        layerId: 'layer-1', channel: 'pixels', sourceToOutput: { tx: -4, ty: 2 } } } } });
    expect(second).toMatchObject({ status: 'completed', reused: true });
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('rejects stale revisions and missing mask channels before rendering', async () => {
    const state = create();
    await expect(state.controller.request({ documentId: 'document-1', layerId: 'layer-1',
      channel: 'pixels', expectedDocumentRevision: 3, maxEdge: 256 }))
      .resolves.toMatchObject({ status: 'rejected', code: 'stale-document-revision', currentRevision: 4 });
    state.state.hasMask = false;
    await expect(state.controller.request({ documentId: 'document-1', layerId: 'layer-1',
      channel: 'mask', expectedDocumentRevision: 4, maxEdge: 256 }))
      .resolves.toMatchObject({ status: 'rejected', code: 'channel-unavailable' });
    expect(state.render).not.toHaveBeenCalled();
  });

  it('does not publish a render if the document revision changes in flight', async () => {
    const state = create();
    state.render.mockImplementationOnce(async () => {
      state.state.canonicalRevision = 5;
      return { file: new File(['png'], 'layer.png', { type: 'image/png' }), width: 80, height: 60,
        sourceToOutput: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } };
    });
    await expect(state.controller.request({ documentId: 'document-1', layerId: 'layer-1',
      channel: 'pixels', expectedDocumentRevision: 4, maxEdge: 256 }))
      .resolves.toMatchObject({ status: 'rejected', code: 'stale-document-revision', currentRevision: 5 });
    expect(state.registry.list()).toHaveLength(0);
  });

  it('separates WebP quality variants in the cache and rejects PNG quality', async () => {
    const state = create();
    const base = { documentId: 'document-1', layerId: 'layer-1', channel: 'pixels',
      expectedDocumentRevision: 4, maxEdge: 256, format: 'webp' };
    await state.controller.request({ ...base, quality: 0.5 });
    await state.controller.request({ ...base, quality: 0.9 });
    expect(state.render).toHaveBeenCalledTimes(2);
    await expect(state.controller.request({ ...base, format: 'png', quality: 0.5 }))
      .resolves.toMatchObject({ status: 'rejected', code: 'invalid-request' });
  });
});
