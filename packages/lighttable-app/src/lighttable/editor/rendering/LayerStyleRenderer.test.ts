import { describe, expect, it, vi } from 'vitest';
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
  drawFullscreen: vi.fn()
});

describe('LayerStyleRenderer', () => {
  it('switches quality only at interaction boundaries', () => {
    const styles = renderer();

    expect(styles.cacheKeyQuality()).toBe('final');
    expect(styles.setInteractionActive(false)).toBe(false);
    expect(styles.setInteractionActive(true)).toBe(true);
    expect(styles.cacheKeyQuality()).toBe('interactive');
    expect(styles.setInteractionActive(true)).toBe(false);
    expect(styles.setInteractionActive(false)).toBe(true);
    expect(styles.cacheKeyQuality()).toBe('final');
  });

  it('owns and releases its work textures', () => {
    const styles = renderer();

    expect(styles.estimatedTextureBytes(32, 16)).toBe(0);
    styles.releaseTargets();
    styles.releaseCache();
    styles.destroy();
  });
});
