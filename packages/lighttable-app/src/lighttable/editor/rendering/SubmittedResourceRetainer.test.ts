import { describe, expect, it, vi } from 'vitest';
import { SubmittedResourceRetainer } from './SubmittedResourceRetainer';

const resource = () => ({ destroy: vi.fn() });

describe('SubmittedResourceRetainer', () => {
  it('releases only the resources retained before a submit boundary', async () => {
    let finishFirstSubmit!: () => void;
    const firstSubmit = new Promise<void>((resolve) => {
      finishFirstSubmit = resolve;
    });
    const queue = [firstSubmit, Promise.resolve()];
    const retainer = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => queue.shift() ?? Promise.resolve()
    });
    const first = resource();
    const second = resource();

    retainer.retainBuffer(first as unknown as GPUBuffer);
    retainer.releaseAfterSubmittedWork();
    retainer.retainTexture(second as unknown as GPUTexture);

    expect(first.destroy).not.toHaveBeenCalled();
    expect(second.destroy).not.toHaveBeenCalled();
    finishFirstSubmit();
    await firstSubmit;
    await Promise.resolve();

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).not.toHaveBeenCalled();
    retainer.releaseAfterSubmittedWork();
    await Promise.resolve();
    await Promise.resolve();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('destroys resources that were encoded but never submitted', () => {
    const retainer = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => Promise.resolve()
    });
    const buffer = resource();
    const texture = resource();
    retainer.retainBuffer(buffer as unknown as GPUBuffer);
    retainer.retainTexture(texture as unknown as GPUTexture);

    retainer.destroyPending();

    expect(buffer.destroy).toHaveBeenCalledOnce();
    expect(texture.destroy).toHaveBeenCalledOnce();
  });

  it('releases submitted resources after device-loss rejection', async () => {
    const retainer = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => Promise.reject(new Error('device lost'))
    });
    const buffer = resource();
    retainer.retainBuffer(buffer as unknown as GPUBuffer);

    retainer.releaseAfterSubmittedWork();
    await Promise.resolve();
    await Promise.resolve();

    expect(buffer.destroy).toHaveBeenCalledOnce();
  });
});
