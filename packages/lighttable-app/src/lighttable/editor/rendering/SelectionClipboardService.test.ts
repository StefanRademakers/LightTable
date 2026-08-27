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
    const textureCodec = { encodeUnchecked: vi.fn(async () => new Blob(['region'])) };
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
      textureCodec: textureCodec as never,
      dimensions: () => ({ width: 64, height: 32 }),
      generation: () => 1,
      pipelines: () => ({} as never),
      invalidateLayer: vi.fn(),
      drawFullscreen: vi.fn()
    });
    vi.spyOn(service, 'encodeLayerCopy').mockReturnValue(true);
    return { service, encoder, finish, submit, textureCodec };
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

  it('encodes final-composite regions through the shared Copy Merged crop owner', async () => {
    const { service, textureCodec } = createService();
    const texture = {} as GPUTexture;
    await expect(service.exportDisplayRegion(
      texture, { x: 16, y: 8, width: 32, height: 16 }, 16
    )).resolves.toBeInstanceOf(Blob);
    expect(textureCodec.encodeUnchecked).toHaveBeenCalledWith(
      texture, false, 16, 8,
      { a: 0.5, b: 0, c: 0, d: 0.5, tx: -8, ty: -4 },
      true,
      { format: 'png' }
    );
  });

  it('pastes a clipboard mask entirely on the GPU without an image roundtrip', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 5, height: 3, close })));
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    try {
      const destination = { format: 'r16float', createView: vi.fn(() => ({})) } as unknown as GPUTexture;
      const source = { createView: vi.fn(() => ({})), destroy: vi.fn() } as unknown as GPUTexture;
      const previous = { createView: vi.fn(() => ({})), destroy: vi.fn() } as unknown as GPUTexture;
      const settings = { destroy: vi.fn() } as unknown as GPUBuffer;
      const copyTextureToTexture = vi.fn();
      const encoder = {
        copyTextureToTexture,
        finish: vi.fn(() => ({}))
      } as unknown as GPUCommandEncoder;
      const textureCodec = { encodeUnchecked: vi.fn(), decode: vi.fn() };
      const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
      const invalidateLayer = vi.fn();
      const drawFullscreen = vi.fn();
      const device = {
        limits: { maxTextureDimension2D: 16_384 },
        createTexture: vi.fn()
          .mockReturnValueOnce(source)
          .mockReturnValueOnce(previous),
        createBuffer: vi.fn(() => settings),
        createBindGroup: vi.fn(() => ({})),
        createCommandEncoder: vi.fn(() => encoder),
        queue: {
          copyExternalImageToTexture: vi.fn(),
          writeBuffer: vi.fn(),
          submit: vi.fn(),
          onSubmittedWorkDone: vi.fn(async () => undefined)
        }
      } as unknown as GPUDevice;
      const service = new SelectionClipboardService({
        device,
        textures: {} as never,
        layerResources: {
          raster: vi.fn(() => null),
          maskTexture: vi.fn(() => destination)
        } as never,
        textureCodec: textureCodec as never,
        dimensions: () => ({ width: 64, height: 32 }),
        generation: () => 1,
        pipelines: () => ({ maskClipboardPaste: pipeline } as never),
        invalidateLayer,
        drawFullscreen
      });

      await expect(service.pasteExternalImage(
        'layer' as never, new Blob(['pixels']), { x: -2, y: 4 }, 'mask'
      )).resolves.toBe(true);

      expect(textureCodec.encodeUnchecked).not.toHaveBeenCalled();
      expect(textureCodec.decode).not.toHaveBeenCalled();
      expect(copyTextureToTexture).toHaveBeenCalledWith(
        { texture: destination }, { texture: previous }, [64, 32]
      );
      expect(drawFullscreen).toHaveBeenCalledWith(
        encoder, pipeline, expect.anything(), expect.anything(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      expect(invalidateLayer).toHaveBeenCalledWith('layer');
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
