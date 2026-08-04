import { describe, expect, it, vi } from 'vitest';
import { RenderTargetPair } from './RenderTargetPair';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

describe('RenderTargetPair', () => {
  it('can allocate and account for one target without allocating the ping-pong pair', () => {
    const createTexture = vi.fn(texture);
    const pair = new RenderTargetPair({
      createTexture,
      firstLabel: 'first',
      secondLabel: 'second'
    });

    const target = pair.ensureSingle();
    expect(pair.ensureSingle()).toBe(target);
    expect(createTexture).toHaveBeenCalledOnce();
    expect(createTexture).toHaveBeenCalledWith('first');
    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(10 * 5 * 8);

    pair.destroy();
    expect(target.destroy).toHaveBeenCalledOnce();
    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(0);
  });

  it('allocates lazily, reuses targets and releases them together', () => {
    const createTexture = vi.fn(texture);
    const pair = new RenderTargetPair({
      createTexture,
      firstLabel: 'first',
      secondLabel: 'second'
    });

    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(0);
    const targets = pair.ensure();
    const reusedTargets = pair.ensure();
    expect(reusedTargets[0]).toBe(targets[0]);
    expect(reusedTargets[1]).toBe(targets[1]);
    expect(createTexture).toHaveBeenNthCalledWith(1, 'first');
    expect(createTexture).toHaveBeenNthCalledWith(2, 'second');
    expect(pair.estimatedTextureBytes(10, 5, 8)).toBe(10 * 5 * 8 * 2);

    pair.destroy();
    expect(targets[0].destroy).toHaveBeenCalledOnce();
    expect(targets[1].destroy).toHaveBeenCalledOnce();
    const replacementTargets = pair.ensure();
    expect(replacementTargets[0]).not.toBe(targets[0]);
    expect(replacementTargets[1]).not.toBe(targets[1]);
  });
});
