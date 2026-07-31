import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../document/documentTypes';
import { LayerCompositor } from './LayerCompositor';

describe('LayerCompositor', () => {
  it('returns the source texture for a neutral one-layer document', () => {
    const document = createImageDocument('Image', 64, 32, 'source');
    const source = {} as GPUTexture;
    const syncDocument = vi.fn();
    const targets = { ensure: vi.fn() };
    const layerStyles = {
      releaseTargets: vi.fn(),
      releaseCache: vi.fn()
    };
    const compositor = new LayerCompositor({
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      compositePipeline: {} as GPURenderPipeline,
      adjustmentMixPipeline: {} as GPURenderPipeline,
      layerResources: {
        raster: vi.fn(() => ({
          texture: source,
          maskTexture: null
        }))
      } as never,
      targets: targets as never,
      submittedResources: {} as never,
      transformSessions: { current: null } as never,
      pixelEditSessions: { current: null } as never,
      geometryPreviews: { resolve: vi.fn(() => null) } as never,
      layerStyles: layerStyles as never,
      dimensions: () => ({ width: 64, height: 32 }),
      syncDocument,
      maskTextureFor: vi.fn(() => null),
      createTexture: vi.fn(),
      clearTexture: vi.fn(),
      drawFullscreen: vi.fn()
    });

    expect(compositor.encode({} as GPUCommandEncoder, document)).toBe(source);
    expect(syncDocument).toHaveBeenCalledWith(document);
    expect(targets.ensure).not.toHaveBeenCalled();
    expect(layerStyles.releaseTargets).toHaveBeenCalledOnce();
    expect(layerStyles.releaseCache).toHaveBeenCalledOnce();
  });
});
