import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerStyleRenderer } from './LayerStyleRenderer';

const renderer = () => new LayerStyleRenderer({
  device: {} as GPUDevice,
  sampler: {} as GPUSampler,
  fullscreenModule: {} as GPUShaderModule,
  shapePipeline: {} as GPURenderPipeline,
  patternAssets: {
    getTexture: vi.fn(),
    estimatedTextureBytes: vi.fn(() => 0)
  } as never,
  submittedResources: {
    retainBuffer: vi.fn()
  } as never,
  dimensions: () => ({ width: 32, height: 16 }),
  createTexture: vi.fn(() => ({ destroy: vi.fn() }) as unknown as GPUTexture),
  createTextureSized: vi.fn(() => ({ destroy: vi.fn() }) as unknown as GPUTexture),
  drawFullscreen: vi.fn()
});

describe('LayerStyleRenderer', () => {
  it('switches quality only at interaction boundaries', () => {
    const styles = renderer();
    const edited = 'edited' as LayerId;
    const retained = 'retained' as LayerId;

    expect(styles.cacheKeyQuality(edited)).toBe('final');
    expect(styles.setInteractionLayer(null)).toBe(false);
    expect(styles.setInteractionLayer(edited)).toBe(true);
    expect(styles.cacheKeyQuality(edited)).toBe('interactive');
    expect(styles.cacheKeyQuality(retained)).toBe('final');
    expect(styles.setInteractionLayer(edited)).toBe(false);
    expect(styles.setInteractionLayer(null)).toBe(true);
    expect(styles.cacheKeyQuality(edited)).toBe('final');
  });

  it('owns and releases its work textures', () => {
    const styles = renderer();

    expect(styles.estimatedTextureBytes(32, 16)).toBe(0);
    styles.releaseTargets();
    styles.releaseCache();
    styles.destroy();
  });
});
