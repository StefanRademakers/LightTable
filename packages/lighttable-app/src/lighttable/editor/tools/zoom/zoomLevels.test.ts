import { describe, expect, it } from 'vitest';
import {
  steppedZoomPercent,
  ZOOM_LEVELS_PERCENT,
  zoomPercentToScale
} from './zoomLevels';

describe('zoomLevels', () => {
  it('steps upward and downward through the canonical zoom ladder', () => {
    expect(steppedZoomPercent(100, 1)).toBe(150);
    expect(steppedZoomPercent(100, -1)).toBe(66.67);
    expect(steppedZoomPercent(70, 1)).toBe(100);
    expect(steppedZoomPercent(70, -1)).toBe(66.67);
  });

  it('clamps at the supported endpoints', () => {
    expect(steppedZoomPercent(0, -1)).toBe(ZOOM_LEVELS_PERCENT[0]);
    expect(steppedZoomPercent(20_000, 1)).toBe(
      ZOOM_LEVELS_PERCENT[ZOOM_LEVELS_PERCENT.length - 1]
    );
  });

  it('converts display percentages to viewport scales', () => {
    expect(zoomPercentToScale(25)).toBe(0.25);
    expect(zoomPercentToScale(10_000)).toBe(100);
  });
});
