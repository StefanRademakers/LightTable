import {
  selectionShapeIsValid,
  type SelectionCombineMode,
  type SelectionPoint,
  type SelectionShape
} from '../../selection/selectionTypes';
import type {
  SelectionGestureFinish,
  SelectionGestureRasterOptions
} from './selectionGestureController';

export type PolygonalSelectionClick =
  | { kind: 'draft'; shape: SelectionShape }
  | { kind: 'finish'; result: SelectionGestureFinish };

const clonePoint = (point: SelectionPoint): SelectionPoint => ({ ...point });

const distanceSquared = (first: SelectionPoint, second: SelectionPoint): number => {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
};

/**
 * Owns a click-driven polygon until it is committed or cancelled.
 *
 * Vertices are document-space points. The closing tolerance is supplied by
 * the viewport in document units, keeping the hit target visually stable at
 * every zoom level without coupling this state machine to DOM coordinates.
 */
export class PolygonalSelectionGestureController {
  private static readonly repeatClickWindowMs = 500;

  private vertices: SelectionPoint[] = [];
  private previewPoint: SelectionPoint | null = null;
  private lastClick: { point: SelectionPoint; timestamp: number } | null = null;
  private mode: SelectionCombineMode = 'replace';
  private rasterOptions: SelectionGestureRasterOptions = {
    featherRadius: 0,
    antiAlias: false
  };

  get active(): boolean {
    return this.vertices.length > 0;
  }

  get draft(): SelectionShape | null {
    if (!this.vertices.length) return null;
    const points = this.vertices.map(clonePoint);
    if (this.previewPoint) points.push(clonePoint(this.previewPoint));
    return { kind: 'polygon', points };
  }

  click(
    point: SelectionPoint,
    mode: SelectionCombineMode,
    closeDistance: number,
    forceClose = false,
    timestamp = Date.now(),
    rasterOptions?: SelectionGestureRasterOptions
  ): PolygonalSelectionClick {
    if (!this.vertices.length) {
      const start = clonePoint(point);
      this.vertices = [start];
      this.previewPoint = clonePoint(start);
      this.lastClick = { point: clonePoint(point), timestamp };
      this.mode = mode;
      this.rasterOptions = rasterOptions ? { ...rasterOptions } : {
        featherRadius: 0,
        antiAlias: false
      };
      return { kind: 'draft', shape: this.draft! };
    }

    const canClose = this.vertices.length >= 3;
    const closeThresholdSquared = Math.max(0, closeDistance) ** 2;
    const elapsedSinceLastClick = timestamp - (this.lastClick?.timestamp ?? Number.NEGATIVE_INFINITY);
    const repeatedNearbyClick = (
      this.lastClick !== null
      && elapsedSinceLastClick >= 0
      && elapsedSinceLastClick <= PolygonalSelectionGestureController.repeatClickWindowMs
      && distanceSquared(point, this.lastClick.point) <= closeThresholdSquared
    );
    if (
      canClose
      && (
        forceClose
        || repeatedNearbyClick
        || distanceSquared(point, this.vertices[0]) <= closeThresholdSquared
      )
    ) {
      return { kind: 'finish', result: this.finish() };
    }

    const last = this.vertices[this.vertices.length - 1];
    if (distanceSquared(point, last) > Number.EPSILON) {
      this.vertices.push(clonePoint(point));
    }
    this.previewPoint = clonePoint(point);
    this.lastClick = { point: clonePoint(point), timestamp };
    return { kind: 'draft', shape: this.draft! };
  }

  move(point: SelectionPoint): SelectionShape | null {
    if (!this.vertices.length) return null;
    this.previewPoint = clonePoint(point);
    return this.draft;
  }

  finish(): SelectionGestureFinish {
    const shape: SelectionShape = {
      kind: 'polygon',
      points: this.vertices.map(clonePoint)
    };
    const mode = this.mode;
    const rasterOptions = { ...this.rasterOptions };
    this.reset();
    return selectionShapeIsValid(shape)
      ? {
          kind: 'apply',
          mode,
          shape,
          featherRadius: Math.max(0, Math.min(250, rasterOptions.featherRadius)),
          antiAlias: rasterOptions.antiAlias
        }
      : mode === 'replace'
        ? { kind: 'clear' }
        : { kind: 'none' };
  }

  cancel(): boolean {
    if (!this.vertices.length) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.vertices = [];
    this.previewPoint = null;
    this.lastClick = null;
    this.mode = 'replace';
    this.rasterOptions = { featherRadius: 0, antiAlias: false };
  }
}
