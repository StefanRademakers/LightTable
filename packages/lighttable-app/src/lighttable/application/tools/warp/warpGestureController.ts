import type {
  WarpBrushMode,
  WarpBrushSettingsSnapshot,
  WarpInputSample,
  WarpStroke
} from '../../../effects/warp/warpTypes';

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
    this.previousPoint = { ...request.point };
    this.samples = [sample(request.point)];
    return this.snapshot(request.point.timeMs);
  }

  move(pointerId: number, point: WarpGesturePoint): WarpStroke | null {
    if (!this.owns(pointerId) || !this.previousPoint) return null;
    const deltaX = point.x - this.previousPoint.x;
    const deltaY = point.y - this.previousPoint.y;
    if (Math.hypot(deltaX, deltaY) < 0.01) return this.snapshot(point.timeMs);
    this.samples.push(sample(point, this.previousPoint));
    this.previousPoint = { ...point };
    return this.snapshot(point.timeMs);
  }

  finish(pointerId: number, timeMs: number): WarpStroke | null {
    if (!this.owns(pointerId)) return null;
    const result = this.samples.length > 1 ? this.snapshot(timeMs) : null;
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
