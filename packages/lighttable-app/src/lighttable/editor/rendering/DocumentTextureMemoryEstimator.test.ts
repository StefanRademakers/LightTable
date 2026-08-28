import { describe, expect, it, vi } from 'vitest';
import { DocumentTextureMemoryEstimator } from './DocumentTextureMemoryEstimator';

describe('DocumentTextureMemoryEstimator', () => {
  it('provides canonical document texture byte sizes to every resource owner', () => {
    const source = vi.fn(({ rgba16Bytes, coverage16Bytes }) =>
      rgba16Bytes + coverage16Bytes);
    const estimator = new DocumentTextureMemoryEstimator({
      dimensions: () => ({ width: 4, height: 3 }),
      sources: [source, () => 7]
    });

    expect(estimator.estimate()).toBe(4 * 3 * 10 + 7);
    expect(source).toHaveBeenCalledWith({
      width: 4,
      height: 3,
      pixels: 12,
      rgba16Bytes: 96,
      coverage16Bytes: 24
    });
  });

  it('uses a one-pixel floor before a document is initialized', () => {
    const estimator = new DocumentTextureMemoryEstimator({
      dimensions: () => ({ width: 0, height: 0 }),
      sources: [({ pixels, rgba16Bytes, coverage16Bytes }) =>
        pixels + rgba16Bytes + coverage16Bytes]
    });

    expect(estimator.estimate()).toBe(11);
  });
});
