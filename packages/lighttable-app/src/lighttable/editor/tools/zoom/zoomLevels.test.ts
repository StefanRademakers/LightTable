import { describe, expect, it } from 'vitest';
import {
  steppedZoomPercent,
  ZOOM_LEVELS_PERCENT,
  zoomPercentToScale
} from './zoomLevels';

describe('zoomLevels', () => {
  it('steps upward and downward through the canonical zoom ladder', () => {
    expect(steppedZoomPercent(100, 1)).toBe(150);
    expect(steppedZoomPercent(100, -1)).toBe(75);
    expect(steppedZoomPercent(70, 1)).toBe(75);
    expect(steppedZoomPercent(70, -1)).toBe(66.67);
  });

  it('retains meaningful working zoom levels', () => {
    expect(ZOOM_LEVELS_PERCENT).toEqual(
      expect.arrayContaining([25, 50, 75, 100])
    );
  });

  it('clamps at the supported endpoints', () => {
    expect(steppedZoomPercent(0, -1)).toBe(ZOOM_LEVELS_PERCENT[0]);
    expect(steppedZoomPercent(20_000, 1)).toBe(
      ZOOM_LEVELS_PERCENT[ZOOM_LEVELS_PERCENT.length - 1]
    );
  });

  it('uses visually proportional steps at high magnification', () => {
    expect(steppedZoomPercent(1000, 1)).toBe(1250);
    expect(steppedZoomPercent(1250, 1)).toBe(1600);
    expect(steppedZoomPercent(1600, 1)).toBe(2000);
    expect(steppedZoomPercent(2000, -1)).toBe(1600);
  });

  it('converts display percentages to viewport scales', () => {
    expect(zoomPercentToScale(25)).toBe(0.25);
    expect(zoomPercentToScale(10_000)).toBe(100);
  });
});
