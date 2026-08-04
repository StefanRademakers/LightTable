import { describe, expect, it } from 'vitest';
import type { TextWarp } from '@lighttable/text-core';
import { unwarpTextPoint, warpTextPoint } from './textWarp';

const bounds = { x: 10, y: 20, width: 100, height: 40 };
const warp = (overrides: Partial<TextWarp> = {}): TextWarp => ({
  style: 'arc', bend: 100, horizontalDistortion: 0, verticalDistortion: 0,
  orientation: 'horizontal', ...overrides
});

describe('text warp geometry', () => {
  it('keeps arc endpoints stable and bends the center resolution-independently', () => {
    expect(warpTextPoint({ x: 10, y: 40 }, warp(), bounds)).toEqual({ x: 10, y: 40 });
    expect(warpTextPoint({ x: 110, y: 40 }, warp(), bounds).y).toBeCloseTo(40);
    expect(warpTextPoint({ x: 60, y: 40 }, warp(), bounds)).toEqual({ x: 60, y: 20 });
  });

  it('interpolates a custom mesh in canonical layer coordinates', () => {
    const custom = warp({ style: 'custom', mesh: { rows: 2, columns: 2, points: [
      { x: 0, y: 0 }, { x: 100, y: 10 }, { x: 10, y: 50 }, { x: 110, y: 60 }
    ] } });
    expect(warpTextPoint({ x: 60, y: 40 }, custom, bounds)).toEqual({ x: 55, y: 30 });
  });

  it('inverts preset and custom envelopes for editor hit-testing', () => {
    const source = { x: 73, y: 44 };
    for (const candidate of [
      warp({ bend: 62, horizontalDistortion: 12, verticalDistortion: -8 }),
      warp({ style: 'custom', mesh: { rows: 2, columns: 2, points: [
        { x: 8, y: 19 }, { x: 115, y: 24 }, { x: 14, y: 63 }, { x: 108, y: 58 }
      ] } })
    ]) {
      const projected = warpTextPoint(source, candidate, bounds);
      expect(unwarpTextPoint(projected, candidate, bounds)).toEqual(expect.objectContaining({
        x: expect.closeTo(source.x, 3),
        y: expect.closeTo(source.y, 3)
      }));
    }
  });
});
