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
      true,
      false
    );
    expect(result.value.tx).toBe(90);
    expect(result.value.ty).toBe(31);
    expect(result.matches).toHaveLength(1);
  });

  it('lets Control bypass the same projective snap target', () => {
    const snapped = snapProjectiveTranslation(
      square,
      { x: 92, y: 0 },
      [snapLineFeature('x', 100, 'guide')],
      1,
      true,
      false
    );
    const bypassed = snapProjectiveTranslation(
      square,
      { x: 92, y: 0 },
      [snapLineFeature('x', 100, 'guide')],
      1,
      true,
      true
    );
    expect(snapped.value[0].x).toBe(90);
    expect(bypassed.value[0].x).toBe(92);
    expect(bypassed.matches).toEqual([]);
  });
});
