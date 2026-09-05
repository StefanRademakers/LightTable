import { describe, expect, it } from 'vitest';
import { snapLineFeature } from '../../../application/tools/snapping/snapEngine';
import { identityMatrix } from './affine';
import { snapAffineTranslation, snapProjectiveTranslation } from './snapTransformTranslation';

const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
] as const;

describe('transform body snapping', () => {
  it('corrects an affine proposal from immutable source geometry', () => {
    const result = snapAffineTranslation(
      square,
      identityMatrix(),
      { x: 92, y: 31 },
      [snapLineFeature('x', 100, 'guide', 'v1')],
      1,
      true
    );
    expect(result.value.tx).toBe(90);
    expect(result.value.ty).toBe(31);
    expect(result.matches).toHaveLength(1);
  });

  it('pixel-aligns a translation-only raster move', () => {
    const result = snapAffineTranslation(
      square,
      identityMatrix(),
      { x: 12.37, y: -4.62 },
      [],
      1,
      true
    );
    expect(result.value.tx).toBe(12);
    expect(result.value.ty).toBe(-5);
  });

  it('preserves subpixel positioning once the transform includes scaling', () => {
    const result = snapAffineTranslation(
      square,
      { a: 1.25, b: 0, c: 0, d: 1.25, tx: 0, ty: 0 },
      { x: 12.37, y: -4.62 },
      [],
      1,
      true
    );
    expect(result.value.tx).toBeCloseTo(12.37);
    expect(result.value.ty).toBeCloseTo(-4.62);
  });

  it('retains a projective snap target until the release threshold is crossed', () => {
    const snapped = snapProjectiveTranslation(
      square,
      { x: 92, y: 0 },
      [snapLineFeature('x', 100, 'guide', 'v1')],
      1,
      true
    );
    const retained = snapProjectiveTranslation(
      square,
      { x: 89, y: 0 },
      [snapLineFeature('x', 100, 'guide', 'v1')],
      1,
      true,
      snapped.matches
    );
    expect(snapped.value[0].x).toBe(90);
    expect(retained.value[0].x).toBe(90);
    expect(retained.matches).toHaveLength(1);
  });
});
