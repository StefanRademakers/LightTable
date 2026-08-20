import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type RasterLayer } from '../../editor/document/documentTypes';
import { executeBackgroundRemovalOperation } from './executeBackgroundRemovalOperation';
import type { BackgroundRemovalModel } from './backgroundRemovalTypes';

const setup = () => {
  let document = createRasterLayer(createImageDocument('Subject', 8, 6, 'asset'));
  const layer = document.layers[0] as RasterLayer;
  const mask = { width: 8, height: 6, data: new Uint8Array(48).fill(255) };
  const model: BackgroundRemovalModel = {
    remove: vi.fn(async (_image, options) => {
      options?.onProgress?.({ phase: 'inference', message: 'Removing', percent: 50 });
      return { mask, modelId: 'ben2', backend: 'wasm' as const, durationMs: 24 };
    }),
    dispose: vi.fn()
  };
  const renderer = { exportLayerForBackgroundRemoval: vi.fn(async () => new Blob(['png'])) };
  const applyMask = vi.fn(() => true);
  return { get document() { return document; }, setDocument: (next: typeof document) => { document = next; },
    layer, mask, model, renderer, applyMask };
};

describe('executeBackgroundRemovalOperation', () => {
  it('exports only the explicit layer and applies its generated mask', async () => {
    const state = setup();
    const onProgress = vi.fn();
    await expect(executeBackgroundRemovalOperation({
      document: state.document, layer: state.layer, renderer: state.renderer,
      model: state.model, mode: 'new-layer', signal: new AbortController().signal,
      getDocument: () => state.document, applyMask: state.applyMask, onProgress
    })).resolves.toMatchObject({ layerId: state.layer.id, mode: 'new-layer', modelId: 'ben2' });
    expect(state.renderer.exportLayerForBackgroundRemoval).toHaveBeenCalledWith(state.document, state.layer);
    expect(state.applyMask).toHaveBeenCalledWith(state.layer.id, state.mask, 'new-layer');
    expect(onProgress).toHaveBeenCalledWith({ phase: 'inference', message: 'Removing', percent: 50 });
  });

  it('rejects a stale result without applying it', async () => {
    const state = setup();
    vi.mocked(state.model.remove).mockImplementation(async () => {
      state.setDocument({ ...state.document, revision: state.document.revision + 1 });
      return { mask: state.mask, modelId: 'ben2', backend: 'wasm', durationMs: 24 };
    });
    await expect(executeBackgroundRemovalOperation({
      document: state.document, layer: state.layer, renderer: state.renderer,
      model: state.model, mode: 'replace', signal: new AbortController().signal,
      getDocument: () => state.document, applyMask: state.applyMask
    })).rejects.toThrow('document changed');
    expect(state.applyMask).not.toHaveBeenCalled();
  });

  it('honors cancellation before model execution', async () => {
    const state = setup();
    const abort = new AbortController();
    vi.mocked(state.renderer.exportLayerForBackgroundRemoval).mockImplementation(async () => {
      abort.abort(); return new Blob(['png']);
    });
    await expect(executeBackgroundRemovalOperation({
      document: state.document, layer: state.layer, renderer: state.renderer,
      model: state.model, mode: 'replace', signal: abort.signal,
      getDocument: () => state.document, applyMask: state.applyMask
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.model.remove).not.toHaveBeenCalled();
  });
});
