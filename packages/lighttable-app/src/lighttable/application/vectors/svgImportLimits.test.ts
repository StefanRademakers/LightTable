import { describe, expect, it } from 'vitest';
import { DEFAULT_SVG_CODEC_LIMITS } from '@lighttable/vector-svg';
import { DEFAULT_SVG_NORMALIZATION_LIMITS } from '@lighttable/vector-svg-normalizer';
import { SVG_IMPORT_MAX_BYTES } from './svgImportLimits';

describe('shared SVG import budget', () => {
  it('keeps application, normalizer and editable codec input limits aligned', () => {
    expect(SVG_IMPORT_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(DEFAULT_SVG_NORMALIZATION_LIMITS.maxInputBytes).toBe(SVG_IMPORT_MAX_BYTES);
    expect(DEFAULT_SVG_NORMALIZATION_LIMITS.maxOutputBytes).toBe(SVG_IMPORT_MAX_BYTES);
    expect(DEFAULT_SVG_CODEC_LIMITS.maxInputBytes).toBe(SVG_IMPORT_MAX_BYTES);
    expect(DEFAULT_SVG_CODEC_LIMITS.maxOutputBytes).toBe(SVG_IMPORT_MAX_BYTES);
  });
});
