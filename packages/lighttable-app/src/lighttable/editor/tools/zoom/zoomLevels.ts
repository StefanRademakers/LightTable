export const ZOOM_LEVELS_PERCENT = [
  1, 1.5, 2, 3, 4, 5, 6.25, 8.33, 12.5, 16.67,
  25, 33.33, 50, 66.67, 75, 100, 150, 200, 300, 400, 500,
  600, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000,
  6400, 8000, 10000
] as const;

export const ZOOM_PRESETS_PERCENT = [
  25, 50, 75, 100, 150, 200
] as const;

const ZOOM_EPSILON = 0.001;

export const steppedZoomPercent = (
  currentPercent: number,
  direction: -1 | 1
): number => {
  if (direction > 0) {
    return ZOOM_LEVELS_PERCENT.find(
      (level) => level > currentPercent + ZOOM_EPSILON
    ) ?? ZOOM_LEVELS_PERCENT[ZOOM_LEVELS_PERCENT.length - 1];
  }

  for (let index = ZOOM_LEVELS_PERCENT.length - 1; index >= 0; index -= 1) {
    if (ZOOM_LEVELS_PERCENT[index] < currentPercent - ZOOM_EPSILON) {
      return ZOOM_LEVELS_PERCENT[index];
    }
  }
  return ZOOM_LEVELS_PERCENT[0];
};

export const zoomPercentToScale = (percent: number): number => percent / 100;
