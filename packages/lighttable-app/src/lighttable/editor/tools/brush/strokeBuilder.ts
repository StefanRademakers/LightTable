import type { Rect } from '../../document/documentTypes';

export interface BrushPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface BrushDab extends BrushPoint {
  size: number;
}

export class StrokeBuilder {
  private previous: BrushPoint | null = null;
  private carry = 0;
  private readonly size: number;
  private readonly spacingRatio: number;

  constructor(size: number, spacingRatio: number) {
    this.size = size;
    this.spacingRatio = spacingRatio;
  }

  begin(point: BrushPoint): BrushDab[] {
    this.previous = point;
    this.carry = 0;
    return [{ ...point, size: this.size }];
  }

  add(point: BrushPoint): BrushDab[] {
    const previous = this.previous;
    if (!previous) return this.begin(point);
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.0001) return [];
    const spacing = Math.max(1, this.size * Math.max(0.01, this.spacingRatio));
    const dabs: BrushDab[] = [];
    let travelled = spacing - this.carry;
    while (travelled <= distance) {
      const t = travelled / distance;
      dabs.push({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        pressure: previous.pressure + (point.pressure - previous.pressure) * t,
        size: this.size
      });
      travelled += spacing;
    }
    this.carry = (this.carry + distance) % spacing;
    this.previous = point;
    return dabs;
  }
}

export const boundsForDabs = (dabs: BrushDab[]): Rect | null => {
  if (!dabs.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  dabs.forEach((dab) => {
    const radius = dab.size / 2;
    left = Math.min(left, dab.x - radius);
    top = Math.min(top, dab.y - radius);
    right = Math.max(right, dab.x + radius);
    bottom = Math.max(bottom, dab.y + radius);
  });
  return { x: left, y: top, width: right - left, height: bottom - top };
};
