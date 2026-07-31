import { describe, expect, it, vi } from 'vitest';
import { RenderTargetPair } from './RenderTargetPair';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('RenderTargetPair', () => {
  it('allocates lazily, reuses targets and releases them together', () => {
    const createTexture = vi.fn(texture);
    const pair = new RenderTargetPair({
      createTexture,
      firstLabel: 'first',
      secondLabel: 'second'
    });

    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(0);
    const targets = pair.ensure();
    expect(pair.ensure()).toBe(targets);
    expect(createTexture).toHaveBeenNthCalledWith(1, 'first');
    expect(createTexture).toHaveBeenNthCalledWith(2, 'second');
    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(10 * 5 * 8 * 2);

    pair.destroy();
    expect(targets[0].destroy).toHaveBeenCalledOnce();
    expect(targets[1].destroy).toHaveBeenCalledOnce();
    expect(pair.ensure()).not.toBe(targets);
  });
});
