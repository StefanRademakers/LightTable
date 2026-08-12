export interface RulerTick {
  position: number;
  major: boolean;
  label?: string;
}

const niceStep = (minimum: number) => {
  const power = 10 ** Math.floor(Math.log10(Math.max(minimum, 1e-9)));
  const normalized = minimum / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
};

/** Shared adaptive tick source for ruler rendering and Shift guide snapping. */
export const rulerTicks = (length: number, zoom: number, origin = 0): RulerTick[] => {
  const majorStep = niceStep(64 / Math.max(1e-6, zoom));
  const minorStep = majorStep / 5;
  const first = origin + Math.ceil((0 - origin) / minorStep) * minorStep;
  const ticks: RulerTick[] = [];
  for (let position = first; position <= length + 1e-6 && ticks.length < 4096; position += minorStep) {
    const major = Math.abs((position - origin) / majorStep - Math.round((position - origin) / majorStep)) < 1e-6;
    ticks.push({ position, major, ...(major ? { label: `${Math.round(position - origin)}` } : {}) });
  }
  return ticks;
};

export const quantizeGuideToRulerTick = (position: number, length: number, zoom: number, origin = 0) => {
  const ticks = rulerTicks(length, zoom, origin);
  return ticks.reduce((best, tick) => (
    Math.abs(tick.position - position) < Math.abs(best - position) ? tick.position : best
  ), ticks[0]?.position ?? position);
};
