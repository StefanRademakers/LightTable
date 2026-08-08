import type { BrushPoint } from './strokeBuilder';

const clampUnit = (value: number) => Number.isFinite(value)
  ? Math.min(1, Math.max(0, value))
  : 0;

/**
 * Low-latency, distance-based stroke smoothing.
 *
 * The filter operates before dab spacing and depends on travelled distance,
 * not pointer-event frequency. A bounded catch-up tail lands the stroke on
 * the last raw point without keeping React or the GPU in the input loop.
 */
export class StrokeSmoother {
  private filtered: BrushPoint | null = null;
  private latestRaw: BrushPoint | null = null;
  private readonly responseDistance: number;

  constructor(amount: number, brushSize: number) {
    const normalized = clampUnit(amount);
    this.responseDistance = normalized <= 0
      ? 0
      : Math.max(0.5, normalized * normalized * Math.min(Math.max(brushSize, 1), 128) * 0.5);
  }

  begin(point: BrushPoint): BrushPoint {
    this.filtered = { ...point };
    this.latestRaw = { ...point };
    return { ...point };
  }

  add(point: BrushPoint): BrushPoint {
    const previous = this.filtered;
    this.latestRaw = { ...point };
    if (!previous || this.responseDistance <= 0) {
      this.filtered = { ...point };
      return { ...point };
    }
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (distance <= 1e-6) return { ...previous, pressure: point.pressure };
    if (distance <= this.responseDistance) {
      return { ...previous, pressure: point.pressure };
    }
    const alpha = (distance - this.responseDistance) / distance;
    this.filtered = {
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
      pressure: previous.pressure + (point.pressure - previous.pressure) * alpha
    };
    return { ...this.filtered };
  }

  finish(): BrushPoint[] {
    const target = this.latestRaw;
    let current = this.filtered;
    if (!target || !current || this.responseDistance <= 0) return [];
    const points: BrushPoint[] = [];
    for (let index = 0; index < 8; index += 1) {
      const distance = Math.hypot(target.x - current.x, target.y - current.y);
      if (distance <= 0.25) break;
      const alpha = Math.min(1, Math.max(0.25, this.responseDistance * 0.25 / distance));
      current = {
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
        pressure: current.pressure + (target.pressure - current.pressure) * alpha
      };
      points.push({ ...current });
    }
    const last = points.at(-1) ?? current;
    if (Math.hypot(target.x - last.x, target.y - last.y) > 1e-6) points.push({ ...target });
    this.filtered = { ...target };
    return points;
  }
}
