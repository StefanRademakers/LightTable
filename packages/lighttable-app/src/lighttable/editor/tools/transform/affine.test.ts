import { describe, expect, it } from 'vitest';
import {
  aroundPoint,
  identityMatrix,
  invertMatrix,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformedBounds,
  transformPoint,
  translationMatrix
} from './affine';

describe('LightTable affine transforms', () => {
  it('round-trips a point through an inverse matrix', () => {
    const matrix = multiplyMatrices(
      translationMatrix(30, -12),
      multiplyMatrices(rotationMatrix(Math.PI / 5), scaleMatrix(1.5, 0.75))
    );
    const inverse = invertMatrix(matrix);
    expect(inverse).not.toBeNull();
    const source = { x: 18, y: 42 };
    const roundTrip = transformPoint(inverse!, transformPoint(matrix, source));
    expect(roundTrip.x).toBeCloseTo(source.x, 6);
    expect(roundTrip.y).toBeCloseTo(source.y, 6);
  });

  it('rejects singular matrices', () => {
    expect(invertMatrix(scaleMatrix(0, 1))).toBeNull();
  });

  it('rotates around an explicit pivot', () => {
    const matrix = aroundPoint(rotationMatrix(Math.PI / 2), { x: 10, y: 10 });
    const result = transformPoint(matrix, { x: 20, y: 10 });
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it('includes all four transformed corners in its bounds', () => {
    const bounds = transformedBounds(rotationMatrix(Math.PI / 2), {
      x: 0,
      y: 0,
      width: 40,
      height: 20
    });
    expect(bounds.x).toBeCloseTo(-20);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(40);
  });

  it('keeps identity stable', () => {
    expect(transformPoint(identityMatrix(), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});
