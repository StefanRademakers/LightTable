import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerStyleRenderer, LayerStyleUniformArena } from './LayerStyleRenderer';
import type { SubmittedResourceRetainer } from './SubmittedResourceRetainer';

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
  createFloatTextureSized: vi.fn(() => ({ destroy: vi.fn() }) as unknown as GPUTexture),
  drawFullscreen: vi.fn()
});

describe('LayerStyleRenderer', () => {
  it('packs transient style uniforms into aligned submit-retained chunks', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const buffer = {} as GPUBuffer;
    const device = {
      limits: { minUniformBufferOffsetAlignment: 256 },
      createBuffer: vi.fn(() => buffer),
      queue: { writeBuffer: vi.fn() }
    } as unknown as GPUDevice;
    const retainBuffer = vi.fn((value: GPUBuffer) => value);
    const submittedResources = { retainBuffer } as unknown as SubmittedResourceRetainer;
    const arena = new LayerStyleUniformArena(device, submittedResources, 1024);

    const first = arena.write(new Float32Array(24), 'first');
    const second = arena.write(new Float32Array(156), 'second');

    expect(first).toEqual({ buffer, offset: 0, size: 96 });
    expect(second).toEqual({ buffer, offset: 256, size: 624 });
    expect(device.createBuffer).toHaveBeenCalledTimes(1);
    expect(retainBuffer).toHaveBeenCalledWith(buffer);
    expect(device.queue.writeBuffer).toHaveBeenNthCalledWith(
      2, buffer, 256, expect.any(Float32Array)
    );
  });

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
