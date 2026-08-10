import type {
  WarpBrushMode,
  WarpBrushSettingsSnapshot,
  WarpInputSample,
  WarpStroke
} from '../../../effects/warp/warpTypes';
import { StrokeSmoother } from '../../../editor/tools/brush/strokeSmoother';

export interface WarpGesturePoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly timeMs: number;
}

export interface BeginWarpGesture {
  readonly pointerId: number;
  readonly strokeId: string;
  readonly mode: WarpBrushMode;
  readonly settings: WarpBrushSettingsSnapshot;
  readonly point: WarpGesturePoint;
}

const cloneSettings = (
  settings: WarpBrushSettingsSnapshot
): WarpBrushSettingsSnapshot => structuredClone(settings);

const sample = (
  point: WarpGesturePoint,
  previous?: WarpGesturePoint
): WarpInputSample => ({
  positionPx: [point.x, point.y],
  deltaPx: previous
    ? [point.x - previous.x, point.y - previous.y]
    : [0, 0],
  pressure: Math.max(0, point.pressure || 1),
  tilt: [point.tiltX ?? 0, point.tiltY ?? 0],
  timeMs: point.timeMs
});

/**
 * Pointer-owned Warp authoring primitive.
 *
 * It knows nothing about React, documents or GPU resources. Input must already
 * be expressed in immutable layer-source pixels, which keeps transformed
 * layers and future host integrations out of the stroke data contract.
 */
export class WarpGestureController {
  private pointerId: number | null = null;
  private mode: WarpBrushMode = 'push';
  private settings: WarpBrushSettingsSnapshot | null = null;
  private strokeId = '';
  private startedAtMs = 0;
  private previousPoint: WarpGesturePoint | null = null;
  private smoother: StrokeSmoother<WarpGesturePoint> | null = null;
  private samples: WarpInputSample[] = [];

  get active(): boolean {
    return this.pointerId !== null;
  }

  owns(pointerId: number): boolean {
    return this.pointerId === pointerId;
  }

  begin(request: BeginWarpGesture): WarpStroke | null {
    if (this.active) return null;
    this.pointerId = request.pointerId;
    this.mode = request.mode;
    this.settings = cloneSettings(request.settings);
    this.strokeId = request.strokeId;
    this.startedAtMs = request.point.timeMs;
    this.smoother = new StrokeSmoother(request.settings.smooth, request.settings.diameterPx);
    const openingPoint = this.smoother.begin(request.point);
    this.previousPoint = { ...openingPoint };
    this.samples = [sample(openingPoint)];
    return this.snapshot(request.point.timeMs);
  }

  move(pointerId: number, point: WarpGesturePoint): WarpStroke | null {
    return this.moveMany(pointerId, [point]);
  }

  /**
   * Consumes one ordered host-input batch and publishes one immutable stroke.
   * This preserves every coalesced tablet sample without repeatedly cloning
   * the complete stroke for samples delivered in the same pointer event.
   */
  moveMany(pointerId: number, points: readonly WarpGesturePoint[]): WarpStroke | null {
    if (!this.owns(pointerId) || !this.previousPoint || !points.length) return null;
    for (const point of points) {
      const filteredPoint = this.smoother?.add(point) ?? point;
      const deltaX = filteredPoint.x - this.previousPoint.x;
      const deltaY = filteredPoint.y - this.previousPoint.y;
      if (Math.hypot(deltaX, deltaY) < 0.01) continue;
      this.samples.push(sample(filteredPoint, this.previousPoint));
      this.previousPoint = { ...filteredPoint };
    }
    return this.snapshot(points[points.length - 1].timeMs);
  }

  tick(pointerId: number, timeMs: number): WarpStroke | null {
    if (!this.owns(pointerId) || !this.previousPoint || this.mode === 'push') {
      return null;
    }
    const point = { ...this.previousPoint, timeMs };
    this.samples.push(sample(point, this.previousPoint));
    this.previousPoint = point;
    return this.snapshot(timeMs);
  }

  finish(pointerId: number, timeMs: number): WarpStroke | null {
    if (!this.owns(pointerId)) return null;
    for (const point of this.smoother?.finish() ?? []) {
      if (!this.previousPoint || Math.hypot(
        point.x - this.previousPoint.x,
        point.y - this.previousPoint.y
      ) < 0.01) continue;
      this.samples.push(sample({ ...point, timeMs }, this.previousPoint));
      this.previousPoint = { ...point, timeMs };
    }
    const result = this.samples.length > 1 || this.mode !== 'push'
      ? this.snapshot(timeMs)
      : null;
    this.reset();
    return result;
  }

  cancel(pointerId: number): boolean {
    if (!this.owns(pointerId)) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.pointerId = null;
    this.settings = null;
    this.strokeId = '';
    this.startedAtMs = 0;
    this.previousPoint = null;
    this.smoother = null;
    this.samples = [];
  }

  private snapshot(timeMs: number): WarpStroke {
    if (!this.settings) throw new Error('Warp gesture is not active.');
    return {
      id: this.strokeId,
      mode: this.mode,
      settings: cloneSettings(this.settings),
      samples: structuredClone(this.samples),
      startedAtMs: this.startedAtMs,
      durationMs: Math.max(0, timeMs - this.startedAtMs)
    };
  }
}
