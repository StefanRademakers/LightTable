import type { LayerId, Rect } from '../../document/documentTypes';
import type { PaintChannel } from '../../session/editorSession';
import type { AffineMatrix } from '../transform/transformTypes';
import {
  boundsForDabs,
  StrokeBuilder,
  type BrushDab,
  type BrushPoint
} from '../brush/strokeBuilder';
import { StrokeSmoother } from '../brush/strokeSmoother';

export interface PaintGestureTarget {
  layerId: LayerId;
  channel: PaintChannel;
  erase: boolean;
  sourceToDocument: AffineMatrix;
}

export interface PaintGestureUpdate {
  target: PaintGestureTarget;
  dabs: BrushDab[];
}

export interface FinishedPaintGesture {
  target: PaintGestureTarget;
  dirtyBounds: Rect | null;
  dabs: BrushDab[];
}

const cloneTarget = (target: PaintGestureTarget): PaintGestureTarget => ({
  ...target,
  sourceToDocument: { ...target.sourceToDocument }
});

const mergeBounds = (first: Rect | null, second: Rect | null): Rect | null => {
  if (!first) return second ? { ...second } : null;
  if (!second) return { ...first };
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * Locks paint gesture state to one pointer, target and coordinate transform.
 *
 * Renderer calls and pixel-history ownership stay outside this class. This
 * controller only guarantees that every dab in a stroke uses the same layer,
 * channel and source-to-document matrix, even when React state changes while
 * the pointer is down.
 */
export class PaintGestureController {
  private activePointerId: number | null = null;
  private target: PaintGestureTarget | null = null;
  private builder: StrokeBuilder | null = null;
  private smoother: StrokeSmoother | null = null;
  private dirtyBounds: Rect | null = null;

  get pointerId(): number | null {
    return this.activePointerId;
  }

  get active(): boolean {
    return this.activePointerId !== null && this.target !== null && this.builder !== null;
  }

  owns(pointerId: number): boolean {
    return this.activePointerId === pointerId;
  }

  begin(
    pointerId: number,
    target: PaintGestureTarget,
    brush: { size: number; spacing: number; smooth: number; maximumSpacingPx?: number },
    point: BrushPoint
  ): PaintGestureUpdate {
    this.activePointerId = pointerId;
    this.target = cloneTarget(target);
    this.builder = new StrokeBuilder(brush.size, brush.spacing, brush.maximumSpacingPx);
    this.smoother = new StrokeSmoother(brush.smooth, brush.size);
    this.dirtyBounds = null;
    return this.update(this.builder.begin(this.smoother.begin(point)));
  }

  move(pointerId: number, point: BrushPoint): PaintGestureUpdate | null {
    return this.moveMany(pointerId, [point]);
  }

  moveMany(pointerId: number, points: readonly BrushPoint[]): PaintGestureUpdate | null {
    if (!this.owns(pointerId) || !this.builder || !this.smoother || !this.target) return null;
    if (!points.length) return null;
    const dabs: BrushDab[] = [];
    for (const point of points) dabs.push(...this.builder.add(this.smoother.add(point)));
    return this.update(dabs);
  }

  finish(pointerId: number): FinishedPaintGesture | null {
    if (!this.owns(pointerId) || !this.target || !this.builder || !this.smoother) return null;
    const dabs = this.smoother.finish().flatMap((point) => this.builder?.add(point) ?? []);
    this.dirtyBounds = mergeBounds(this.dirtyBounds, boundsForDabs(dabs));
    const result = {
      target: cloneTarget(this.target),
      dirtyBounds: this.dirtyBounds ? { ...this.dirtyBounds } : null,
      dabs
    };
    this.reset();
    return result;
  }

  cancel(pointerId?: number): FinishedPaintGesture | null {
    if (pointerId !== undefined && !this.owns(pointerId)) return null;
    if (!this.target) {
      this.reset();
      return null;
    }
    const result = {
      target: cloneTarget(this.target),
      dirtyBounds: this.dirtyBounds ? { ...this.dirtyBounds } : null,
      dabs: []
    };
    this.reset();
    return result;
  }

  reset(): void {
    this.activePointerId = null;
    this.target = null;
    this.builder = null;
    this.smoother = null;
    this.dirtyBounds = null;
  }

  private update(dabs: BrushDab[]): PaintGestureUpdate {
    if (!this.target) throw new Error('Paint gesture target is unavailable.');
    this.dirtyBounds = mergeBounds(this.dirtyBounds, boundsForDabs(dabs));
    return {
      target: cloneTarget(this.target),
      dabs
    };
  }
}
