import { describe, expect, it } from 'vitest';
import { DEFAULT_SVG_NORMALIZATION_LIMITS } from './normalizeSvg';

describe('SVG normalization boundary', () => {
  it('publishes bounded immutable defaults', () => {
    expect(DEFAULT_SVG_NORMALIZATION_LIMITS).toEqual({
      maxInputBytes: 32 * 1024 * 1024,
      maxOutputBytes: 32 * 1024 * 1024,
      maxElements: 250_000,
      maxDepth: 256
    });
    expect(Object.isFrozen(DEFAULT_SVG_NORMALIZATION_LIMITS)).toBe(true);
  });
});
