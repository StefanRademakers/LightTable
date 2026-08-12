import { describe, expect, it } from 'vitest';
import { quantizeGuideToRulerTick, rulerTicks } from './rulerTicks';

describe('ruler ticks', () => {
  it('keeps major labels readable while zoom changes', () => {
    const low = rulerTicks(1000, 0.25).filter(({ major }) => major);
    const high = rulerTicks(1000, 4).filter(({ major }) => major);
    expect(low[1].position - low[0].position).toBeGreaterThan(high[1].position - high[0].position);
  });

  it('uses the rendered tick source for Shift quantization', () => {
    const ticks = rulerTicks(500, 1);
    const snapped = quantizeGuideToRulerTick(42, 500, 1);
    expect(ticks.some(({ position }) => position === snapped)).toBe(true);
  });
});
