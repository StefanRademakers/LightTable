import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdvancedImageIoCapabilities } from './advancedImageIoCapabilities';

describe('advanced LightTable image I/O capabilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed before an optional worker or decoder is loaded', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    vi.stubGlobal('SharedArrayBuffer', undefined);
    vi.stubGlobal('Worker', undefined);

    const result = getAdvancedImageIoCapabilities();

    expect(result.available).toBe(false);
    expect(result.reasons).toContain('The page is not cross-origin isolated (COOP/COEP).');
    expect(result.reasons).toContain('SharedArrayBuffer is not available.');
    expect(result.reasons).toContain('Web Workers are not available.');
  });
});
