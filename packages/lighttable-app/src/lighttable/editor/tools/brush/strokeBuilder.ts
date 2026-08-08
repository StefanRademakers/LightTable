import type { Rect } from '../../document/documentTypes';

export interface BrushPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface BrushDab extends BrushPoint {
  size: number;
  /** Fraction of one user-requested spacing interval represented by this dab. */
  flowScale: number;
}

/** Compact analytic tip contract consumed by the instanced paint renderer. */
export interface BrushTipDefinition {
  readonly roundness: number;
  readonly angleDegrees: number;
  readonly roughness: number;
}

export const DEFAULT_BRUSH_TIP: BrushTipDefinition = {
  roundness: 1,
  angleDegrees: 0,
  roughness: 0
};

export class StrokeBuilder {
  private previous: BrushPoint | null = null;
  private carry = 0;
  private readonly size: number;
  private readonly spacingRatio: number;
  private readonly maximumSpacingPx: number;

  constructor(size: number, spacingRatio: number, maximumSpacingPx = 1.5) {
    this.size = size;
    this.spacingRatio = spacingRatio;
    this.maximumSpacingPx = Math.max(0.25, maximumSpacingPx);
  }

  begin(point: BrushPoint): BrushDab[] {
    this.previous = point;
    this.carry = 0;
    return [{ ...point, size: this.size, flowScale: 1 }];
  }

  add(point: BrushPoint): BrushDab[] {
    const previous = this.previous;
    if (!previous) return this.begin(point);
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.0001) return [];
    const requestedSpacing = Math.max(1, this.size * Math.max(0.01, this.spacingRatio));
    const spacing = Math.min(this.maximumSpacingPx, requestedSpacing);
    const flowScale = Math.min(1, spacing / requestedSpacing);
    const dabs: BrushDab[] = [];
    let travelled = spacing - this.carry;
    while (travelled <= distance) {
      const t = travelled / distance;
      dabs.push({
        x: previous.x + dx * t,
        y: previous.y + dy * t,
        pressure: previous.pressure + (point.pressure - previous.pressure) * t,
        size: this.size,
        flowScale
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
