import { describe, expect, it } from 'vitest';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { blurBrushSourceBounds, brushHistoryRegions } from './brushHistoryRegions';

const referenceRegion = (dab: BrushDab, matrix: AffineMatrix) => {
  const radius = dab.size * 0.5;
  const corners = [
    [dab.x - radius, dab.y - radius],
    [dab.x + radius, dab.y - radius],
    [dab.x - radius, dab.y + radius],
    [dab.x + radius, dab.y + radius]
  ];
  const projected = corners.map(([x, y]) => ({
    x: matrix.a * x! + matrix.c * y! + matrix.tx,
    y: matrix.b * x! + matrix.d * y! + matrix.ty
  }));
  const left = Math.min(...projected.map(({ x }) => x)) - 2;
  const top = Math.min(...projected.map(({ y }) => y)) - 2;
  const right = Math.max(...projected.map(({ x }) => x)) + 2;
  const bottom = Math.max(...projected.map(({ y }) => y)) + 2;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

describe('brushHistoryRegions', () => {
  it('matches four-corner affine projection without hot-path corner arrays', () => {
    const dabs: BrushDab[] = [
      { x: 30, y: 20, size: 12, pressure: 1, flowScale: 1 },
      { x: -5, y: 42, size: 80, pressure: 0.4, flowScale: 0.25 }
    ];
    const transforms: AffineMatrix[] = [
      { a: 1, b: 0, c: 0, d: 1, tx: -10, ty: -5 },
      { a: 0, b: 1.5, c: -0.75, d: 0, tx: 13, ty: -7 },
      { a: 1.2, b: -0.35, c: 0.45, d: 0.8, tx: -21, ty: 16 }
    ];

    for (const transform of transforms) {
      const actual = brushHistoryRegions(dabs, transform);
      const expected = dabs.map((dab) => referenceRegion(dab, transform));
      for (let index = 0; index < dabs.length; index += 1) {
        expect(actual[index]?.x).toBeCloseTo(expected[index]!.x);
        expect(actual[index]?.y).toBeCloseTo(expected[index]!.y);
        expect(actual[index]?.width).toBeCloseTo(expected[index]!.width);
        expect(actual[index]?.height).toBeCloseTo(expected[index]!.height);
      }
    }
  });

  it('keeps an empty batch allocation-bounded and empty', () => {
    expect(brushHistoryRegions([], { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }))
      .toEqual([]);
  });

  it('keeps a conservative Blur Brush sample halo inside the raster', () => {
    expect(blurBrushSourceBounds(
      [{ x: 300, y: 200, size: 80, pressure: 1, flowScale: 1 }],
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      4096,
      4096
    )).toEqual({ x: 254, y: 154, width: 92, height: 92 });
    expect(blurBrushSourceBounds(
      [{ x: -100, y: -100, size: 10, pressure: 1, flowScale: 1 }],
      { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      64,
      64
    )).toBeNull();
  });
});
