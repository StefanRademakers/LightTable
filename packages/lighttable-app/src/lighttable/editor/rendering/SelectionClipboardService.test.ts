import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import {
  SelectionClipboardService,
  selectionClipboardCrop
} from './SelectionClipboardService';

describe('selectionClipboardCrop', () => {
  it('rounds outward and clips a selection to the document', () => {
    expect(selectionClipboardCrop(
      { x: -2.4, y: 3.2, width: 12.6, height: 9.1 },
      10,
      10
    )).toEqual({ x: 0, y: 3, width: 10, height: 7 });
  });

  it('keeps an empty out-of-canvas crop valid for GPU allocation', () => {
    expect(selectionClipboardCrop(
      { x: 20, y: 20, width: 0, height: 0 },
      10,
      10
    )).toEqual({ x: 20, y: 20, width: 1, height: 1 });
  });
});

describe('SelectionClipboardService copy orchestration', () => {
  const createService = () => {
    const finish = vi.fn(() => ({}) as GPUCommandBuffer);
    const encoder = { finish } as unknown as GPUCommandEncoder;
    const submit = vi.fn();
    const service = new SelectionClipboardService({
      device: {
        createCommandEncoder: vi.fn(() => encoder),
        queue: { submit }
      } as unknown as GPUDevice,
      textures: {
        active: true,
        mask: {} as GPUTexture
      } as never,
      layerResources: {} as never,
      textureCodec: {} as never,
      dimensions: () => ({ width: 64, height: 32 }),
      generation: () => 1,
      pipelines: () => ({} as never),
      invalidateLayer: vi.fn(),
      drawFullscreen: vi.fn()
    });
    vi.spyOn(service, 'encodeLayerCopy').mockReturnValue(true);
    return { service, encoder, finish, submit };
  };

  it('isolates a visible layer with normal blend before copying its selection', () => {
    const { service, encoder, finish, submit } = createService();
    const document = createImageDocument('Clipboard', 64, 32, 'source');
    document.layers[0].blendMode = 'multiply';
    const texture = {} as GPUTexture;
    const encodeComposite = vi.fn(() => texture);
    const release = vi.fn();

    expect(service.copySelectedLayer(
      document,
      document.layers[0].id,
      encodeComposite,
      release
    )).toBe(true);

    expect(encodeComposite).toHaveBeenCalledWith(
      encoder,
      expect.objectContaining({
        layers: [
          expect.objectContaining({
            id: document.layers[0].id,
            blendMode: 'normal'
          })
        ]
      })
    );
    expect(service.encodeLayerCopy).toHaveBeenCalledWith(encoder, texture);
    expect(finish).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not encode hidden or missing raster layers', () => {
    const { service, submit } = createService();
    const document = createImageDocument('Clipboard', 64, 32, 'source');
    document.layers[0].visible = false;
    const encodeComposite = vi.fn();

    expect(service.copySelectedLayer(
      document,
      document.layers[0].id,
      encodeComposite,
      vi.fn()
    )).toBe(false);
    expect(encodeComposite).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
