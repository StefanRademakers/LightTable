import { describe, expect, it } from 'vitest';
import type { ParagraphTextLayout, TextLineMetrics } from './types';
import { realizeParagraphFrame } from './paragraphLayout';

const layout = (overflow: ParagraphTextLayout['overflow']): ParagraphTextLayout => ({
  mode: 'paragraph',
  frame: { x: 10, y: 20, width: 120, height: 40 },
  overflow,
  writingMode: 'horizontal-tb'
});

const lines: readonly TextLineMetrics[] = [
  { start: 0, end: 5, baseline: 32, ascent: 10, descent: 2,
    bounds: { x: 10, y: 22, width: 50, height: 12 } },
  { start: 5, end: 10, baseline: 48, ascent: 10, descent: 2,
    bounds: { x: 10, y: 38, width: 60, height: 12 } },
  { start: 10, end: 15, baseline: 64, ascent: 10, descent: 2,
    bounds: { x: 10, y: 54, width: 55, height: 12 } }
];

describe('paragraph frame realization', () => {
  it.each(['visible', 'clip', 'indicator'] as const)(
    'reports the first overflowing line for %s policy',
    (overflow) => {
      expect(realizeParagraphFrame(layout(overflow), lines)).toEqual({
        bounds: { x: 10, y: 20, width: 120, height: 40 },
        overflow,
        overflowed: true,
        firstOverflowTextOffset: 10
      });
    }
  );

  it('omits an overflow offset when every line fits', () => {
    expect(realizeParagraphFrame(layout('indicator'), lines.slice(0, 2))).toEqual({
      bounds: { x: 10, y: 20, width: 120, height: 40 },
      overflow: 'indicator',
      overflowed: false
    });
  });
});
