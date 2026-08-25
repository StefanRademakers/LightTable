import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;
const layerId = 'layer' as LayerId;
const options = (createTexture = vi.fn(texture)) => ({
  createTexture,
  createTextureSized: vi.fn(texture),
  createFloatTextureSized: vi.fn(texture)
});

describe('LayerStyleTextureStore', () => {
  it('reuses work textures until their explicit release boundary', () => {
    const createTexture = vi.fn(texture);
    const store = new LayerStyleTextureStore(options(createTexture));

    const first = store.ensureWorkTextures();
    expect(store.ensureWorkTextures()).toBe(first);
    expect(createTexture).toHaveBeenCalledTimes(3);

    store.releaseWorkTextures();
    expect(first.shape.destroy).toHaveBeenCalledOnce();
    expect(first.first.destroy).toHaveBeenCalledOnce();
    expect(first.second.destroy).toHaveBeenCalledOnce();
    expect(store.ensureWorkTextures()).not.toBe(first);
  });

  it('keeps cache entries stable until their key changes or they are invalidated', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const source = texture();

    store.writeCache(encoder, layerId, 'first', 'Layer', source, { x: 4, y: 3, width: 20, height: 10 });
    const cached = store.cached(layerId, 'first');
    expect(cached).not.toBeNull();
    expect(storeOptions.createTextureSized).toHaveBeenCalledWith(
      'LightTable cached Layer Style: Layer', 20, 10
    );
    expect(encoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: source, origin: { x: 4, y: 3 } },
      { texture: cached?.texture },
      [20, 10]
    );
    expect(store.cached(layerId, 'other')).toBeNull();

    store.writeCache(encoder, layerId, 'other', 'Layer', source, { x: 4, y: 3, width: 20, height: 10 });
    expect(store.cached(layerId, 'other')).toBe(cached);
    store.invalidate(layerId);
    expect(cached?.texture.destroy).toHaveBeenCalledOnce();
  });

  it('reuses and releases radius-scaled blur work textures', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const first = store.ensureBlurTextures(250, 125);
    expect(store.ensureBlurTextures(250, 125)).toBe(first);
    expect(storeOptions.createTextureSized).toHaveBeenCalledTimes(2);
    store.releaseWorkTextures();
    expect(first.horizontal.destroy).toHaveBeenCalledOnce();
    expect(first.vertical.destroy).toHaveBeenCalledOnce();
  });

  it('bounds historic blur scales and retires evictions through the owner policy', () => {
    const retired: GPUTexture[] = [];
    const storeOptions = {
      ...options(),
      maxBlurTexturePairs: 2,
      retireTexture: (target: GPUTexture) => retired.push(target)
    };
    const store = new LayerStyleTextureStore(storeOptions);
    const first = store.ensureBlurTextures(960, 540);
    const second = store.ensureBlurTextures(640, 360);

    // Touching the first pair makes the second pair the LRU entry.
    expect(store.ensureBlurTextures(960, 540)).toBe(first);
    store.ensureBlurTextures(480, 270);

    expect(retired).toEqual([second.horizontal, second.vertical]);
    expect(first.horizontal.destroy).not.toHaveBeenCalled();
    expect(store.estimatedTextureBytes(1920, 1080)).toBe(
      (960 * 540 + 480 * 270) * 8 * 2
    );
  });

  it('reuses one ROI-sized bevel field pair and submit-fences replacement', () => {
    const retired: GPUTexture[] = [];
    const storeOptions = {
      ...options(),
      retireTexture: (target: GPUTexture) => retired.push(target)
    };
    const store = new LayerStyleTextureStore(storeOptions);
    const first = store.ensureBevelFieldTextures(120, 80);

    expect(store.ensureBevelFieldTextures(120, 80)).toBe(first);
    expect(storeOptions.createTextureSized).toHaveBeenCalledTimes(2);

    const replacement = store.ensureBevelFieldTextures(64, 32);
    expect(replacement).not.toBe(first);
    expect(retired).toEqual([first.first, first.second]);
    expect(first.first.destroy).not.toHaveBeenCalled();
    expect(store.estimatedTextureBytes(1920, 1080)).toBe(64 * 32 * 8 * 2);

    store.releaseWorkTextures();
    expect(retired).toEqual([first.first, first.second, replacement.first, replacement.second]);
  });

  it('retains Bevel geometry independently from the final styled presentation', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    const source = texture();

    const first = store.writeBevelGeometry(
      encoder, layerId, 'bevel', 'matte:size-32', source,
      { x: 0, y: 0, width: 40, height: 30 }, 'float'
    );
    expect(store.cachedBevelGeometry(layerId, 'bevel', 'matte:size-32')).toBe(first);
    expect(store.cachedBevelGeometry(layerId, 'bevel', 'lighting-only-change')).toBeNull();
    expect(storeOptions.createFloatTextureSized).toHaveBeenCalledWith(
      'LightTable retained Bevel height: bevel', 40, 30
    );
    expect(encoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: source }, { texture: first.texture }, [40, 30]
    );

    store.invalidate(layerId);
    expect(first.texture.destroy).toHaveBeenCalledOnce();
  });

  it('keeps high-precision Bevel ping-pong targets ROI-sized', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const first = store.ensureBevelHeightTextures(96, 48);
    expect(store.ensureBevelHeightTextures(96, 48)).toBe(first);
    expect(storeOptions.createFloatTextureSized).toHaveBeenCalledTimes(2);
    expect(store.estimatedTextureBytes(1000, 1000)).toBe(96 * 48 * 16 * 2);
  });

  it('reallocates a tight cache only when its dimensions change', () => {
    const storeOptions = options();
    const store = new LayerStyleTextureStore(storeOptions);
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    store.writeCache(encoder, layerId, 'first', 'Layer', texture(), { x: 1, y: 2, width: 20, height: 10 });
    const first = store.cached(layerId, 'first')!;

    store.writeCache(encoder, layerId, 'moved', 'Layer', texture(), { x: 5, y: 6, width: 20, height: 10 });
    expect(store.cached(layerId, 'moved')?.texture).toBe(first.texture);
    expect(first.texture.destroy).not.toHaveBeenCalled();

    store.writeCache(encoder, layerId, 'resized', 'Layer', texture(), { x: 5, y: 6, width: 21, height: 10 });
    expect(first.texture.destroy).toHaveBeenCalledOnce();
    expect(storeOptions.createTextureSized).toHaveBeenCalledTimes(2);
  });

  it('reports cache and work-target ownership', () => {
    const store = new LayerStyleTextureStore(options());
    const encoder = { copyTextureToTexture: vi.fn() } as unknown as GPUCommandEncoder;
    store.ensureWorkTextures();
    store.writeCache(encoder, layerId, 'key', 'Layer', texture(), { x: 0, y: 0, width: 10, height: 5 });

    expect(store.estimatedTextureBytes(10, 5)).toBe(10 * 5 * 8 * 4);
  });
});
