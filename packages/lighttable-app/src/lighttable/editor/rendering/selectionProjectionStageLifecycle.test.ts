import { describe, expect, it, vi } from 'vitest';
import { createSelectionProjectionStageDisposer } from './selectionProjectionStageLifecycle';

describe('selection projection stage lifecycle', () => {
  it('destroys pooled scratch and textures exactly once', () => {
    const rasterizer = { destroy: vi.fn() };
    const textures = { destroy: vi.fn() };
    const dispose = createSelectionProjectionStageDisposer(rasterizer, textures);

    dispose();
    dispose();

    expect(rasterizer.destroy).toHaveBeenCalledOnce();
    expect(textures.destroy).toHaveBeenCalledOnce();
  });

  it('still destroys textures when scratch cleanup fails', () => {
    const textures = { destroy: vi.fn() };
    const dispose = createSelectionProjectionStageDisposer(
      { destroy: () => { throw new Error('scratch cleanup failed'); } },
      textures,
    );

    expect(() => dispose()).toThrow('scratch cleanup failed');
    expect(textures.destroy).toHaveBeenCalledOnce();
  });
});
