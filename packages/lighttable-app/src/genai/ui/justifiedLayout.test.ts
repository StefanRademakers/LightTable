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
});
