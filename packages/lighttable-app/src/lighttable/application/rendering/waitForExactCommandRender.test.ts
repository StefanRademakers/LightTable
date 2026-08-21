import { describe, expect, it, vi } from 'vitest';
import { waitForExactCommandRender } from './waitForExactCommandRender';

describe('waitForExactCommandRender', () => {
  it('reports a pending derived render without rejecting an already committed command', async () => {
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callback(0) });
    const waitForTextSourcesForExport = vi.fn(async () => false);
    const renderer = { waitForTextSourcesForExport } as never;

    await expect(waitForExactCommandRender(renderer)).resolves.toBe(false);
    expect(waitForTextSourcesForExport).toHaveBeenCalledTimes(12);
    vi.unstubAllGlobals();
  });

  it('keeps cancellation observable', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callback(0) });
    const renderer = { waitForTextSourcesForExport: vi.fn(async () => false) } as never;

    await expect(waitForExactCommandRender(renderer, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });
});
