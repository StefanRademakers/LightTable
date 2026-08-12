import { describe, expect, it } from 'vitest';
import { buildJustifiedLayout } from './justifiedLayout';

describe('buildJustifiedLayout', () => {
  it('fills completed rows while preserving media aspect ratios', () => {
    const layout = buildJustifiedLayout([
      { key: 'wide', aspectRatio: 2 },
      { key: 'square', aspectRatio: 1 },
      { key: 'portrait', aspectRatio: 0.5 }
    ], 600, 180, 3, 27);
    expect(layout.items).toHaveLength(3);
    const first = layout.items[0]!;
    const second = layout.items[1]!;
    expect(first.width / first.height).toBeCloseTo(2, 5);
    expect(second.width / second.height).toBeCloseTo(1, 5);
    const third = layout.items[2]!;
    expect(third.x + third.width).toBeCloseTo(600, 5);
    expect(third.width / third.height).toBeCloseTo(0.5, 5);
  });

  it('does not stretch an incomplete final row', () => {
    const layout = buildJustifiedLayout([{ key: 'wide', aspectRatio: 2 }], 800, 180, 3, 27);
    expect(layout.items[0]).toMatchObject({ width: 360, height: 180 });
  });

  it.each([
    ['cinema', 21 / 9],
    ['landscape', 4 / 3],
    ['portrait', 4 / 5],
    ['vertical', 9 / 16],
    ['extreme portrait', 1 / 20]
  ])('preserves an arbitrary %s ratio', (_name, aspectRatio) => {
    const layout = buildJustifiedLayout([{ key: 'media', aspectRatio }], 800, 180, 3, 27);
    const item = layout.items[0]!;
    expect(item.width / item.height).toBeCloseTo(aspectRatio, 5);
  });

  it('uses a square fallback only for invalid ratios', () => {
    const layout = buildJustifiedLayout([
      { key: 'zero', aspectRatio: 0 },
      { key: 'nan', aspectRatio: Number.NaN }
    ], 800, 180, 3, 27);
    expect(layout.items[0]!.width / layout.items[0]!.height).toBeCloseTo(1, 5);
    expect(layout.items[1]!.width / layout.items[1]!.height).toBeCloseTo(1, 5);
  });
});
