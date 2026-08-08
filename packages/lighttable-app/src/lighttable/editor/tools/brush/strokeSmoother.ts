import type { BrushPoint } from './strokeBuilder';

export const MAX_STROKE_SMOOTH = 2;

const clampAmount = (value: number) => Number.isFinite(value)
  ? Math.min(MAX_STROKE_SMOOTH, Math.max(0, value))
  : 0;

export interface SmoothableStrokePoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

/**
 * Low-latency, distance-based stroke smoothing.
 *
 * The filter operates before dab spacing and depends on travelled distance,
 * not pointer-event frequency. A bounded catch-up tail lands the stroke on
 * the last raw point without keeping React or the GPU in the input loop.
 */
export class StrokeSmoother<Point extends SmoothableStrokePoint = BrushPoint> {
  private filtered: Point | null = null;
  private latestRaw: Point | null = null;
  private readonly responseDistance: number;

  constructor(amount: number, brushSize: number) {
    const normalized = clampAmount(amount);
    this.responseDistance = normalized <= 0
      ? 0
      : Math.max(0.5, normalized * normalized * Math.min(Math.max(brushSize, 1), 128) * 0.5);
  }

  begin(point: Point): Point {
    this.filtered = { ...point };
    this.latestRaw = { ...point };
    return { ...point };
  }

  add(point: Point): Point {
    const previous = this.filtered;
    this.latestRaw = { ...point };
    if (!previous || this.responseDistance <= 0) {
      this.filtered = { ...point };
      return { ...point };
    }
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (distance <= 1e-6) return { ...point, x: previous.x, y: previous.y };
    if (distance <= this.responseDistance) {
      return { ...point, x: previous.x, y: previous.y };
    }
    const alpha = (distance - this.responseDistance) / distance;
    this.filtered = {
      ...point,
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
      pressure: previous.pressure + (point.pressure - previous.pressure) * alpha
    } as Point;
    return { ...this.filtered };
  }

  finish(): Point[] {
    const target = this.latestRaw;
    let current = this.filtered;
    if (!target || !current || this.responseDistance <= 0) return [];
    const points: Point[] = [];
    for (let index = 0; index < 8; index += 1) {
      const distance = Math.hypot(target.x - current.x, target.y - current.y);
      if (distance <= 0.25) break;
      const alpha = Math.min(1, Math.max(0.25, this.responseDistance * 0.25 / distance));
      current = {
        ...target,
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
        pressure: current.pressure + (target.pressure - current.pressure) * alpha
      } as Point;
      points.push({ ...current });
    }
    const last = points.at(-1) ?? current;
    if (Math.hypot(target.x - last.x, target.y - last.y) > 1e-6) points.push({ ...target });
    this.filtered = { ...target };
    return points;
  }
}
