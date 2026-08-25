import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterTargetPool } from './FilterTargetPool';

describe('FilterTargetPool', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
  });

  it('reuses three document-sized targets and never returns an excluded texture', () => {
    const textures = Array.from({ length: 6 }, (_, index) => ({ index, destroy: vi.fn() }));
    const device = { createTexture: vi.fn(() => textures.shift()!) } as unknown as GPUDevice;
    const pool = new FilterTargetPool(device);
    pool.configure(100, 50);
    expect(device.createTexture).not.toHaveBeenCalled();
    const first = pool.acquire([]);
    expect(device.createTexture).toHaveBeenCalledOnce();
    const second = pool.acquire([first]);
    const third = pool.acquire([first, second]);
    expect(device.createTexture).toHaveBeenCalledTimes(3);
    expect(new Set([first, second, third]).size).toBe(3);
    pool.configure(100, 50);
    expect(device.createTexture).toHaveBeenCalledTimes(3);
    expect(pool.estimatedTextureBytes()).toBe(100 * 50 * 8 * 3);
  });

  it('lets one-pass filters retain only the target count they require', () => {
    const texture = { destroy: vi.fn() };
    const device = { createTexture: vi.fn(() => texture) } as unknown as GPUDevice;
    const pool = new FilterTargetPool(device, 1);
    pool.configure(12, 8);
    expect(pool.acquire([])).toBe(texture);
    expect(device.createTexture).toHaveBeenCalledOnce();
    expect(pool.estimatedTextureBytes()).toBe(12 * 8 * 8);
  });

  it('rejects an unusable target count at construction', () => {
    expect(() => new FilterTargetPool({} as GPUDevice, 0)).toThrow(/positive integer/u);
  });
});
