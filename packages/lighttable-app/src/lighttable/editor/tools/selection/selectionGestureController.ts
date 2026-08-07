import {
  selectionShapeIsValid,
  type SelectionCombineMode,
  type SelectionPoint,
  type SelectionShape,
  type GeometricSelectionToolId
} from '../../selection/selectionTypes';
import { selectionKindForTool } from '../toolCapabilities';

export type SelectionGestureFinish =
  | { kind: 'apply'; mode: SelectionCombineMode; shape: SelectionShape }
  | { kind: 'clear' }
  | { kind: 'none' };

const clonePoint = (point: SelectionPoint): SelectionPoint => ({ ...point });

const cloneShape = (shape: SelectionShape): SelectionShape => ({
  ...shape,
  points: shape.points.map(clonePoint)
});

type StripSelectionTool = 'select-horizontal' | 'select-vertical';

export interface SelectionStripOptions {
  documentWidth: number;
  documentHeight: number;
  size: number;
}

const finiteExtent = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const finiteStripSize = (value: number) => Math.max(1, Math.round(Number.isFinite(value) ? value : 1));

/** Builds a full-width row or full-height column around the pointer position. */
export const selectionStripShape = (
  tool: StripSelectionTool,
  point: SelectionPoint,
  options: SelectionStripOptions
): SelectionShape => {
  const documentWidth = finiteExtent(options.documentWidth);
  const documentHeight = finiteExtent(options.documentHeight);
  const extent = tool === 'select-horizontal' ? documentHeight : documentWidth;
  const size = Math.min(extent, finiteStripSize(options.size));
  const coordinate = tool === 'select-horizontal' ? point.y : point.x;
  const maximumStart = Math.max(0, extent - size);
  const start = Math.max(
    0,
    Math.min(maximumStart, Math.floor(coordinate - (size - 1) * 0.5))
  );
  return tool === 'select-horizontal'
    ? {
        kind: 'rectangle',
        points: [{ x: 0, y: start }, { x: documentWidth, y: start + size }]
      }
    : {
        kind: 'rectangle',
        points: [{ x: start, y: 0 }, { x: start + size, y: documentHeight }]
      };
};

/**
 * Owns the complete lifecycle of one pointer-driven selection gesture.
 *
 * Coordinates are already projected into document space by the viewport
 * adapter. The controller intentionally knows nothing about React or WebGPU;
 * it only locks the pointer owner, evolves the draft and describes the final
 * selection mutation.
 */
export class SelectionGestureController {
  private activePointerId: number | null = null;
  private activeDraft: SelectionShape | null = null;
  private activeMode: SelectionCombineMode = 'replace';
  private activeStrip: { tool: StripSelectionTool; options: SelectionStripOptions } | null = null;

  get pointerId(): number | null {
    return this.activePointerId;
  }

  get draft(): SelectionShape | null {
    return this.activeDraft ? cloneShape(this.activeDraft) : null;
  }

  owns(pointerId: number): boolean {
    return this.activePointerId === pointerId;
  }

  begin(
    pointerId: number,
    tool: GeometricSelectionToolId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    stripOptions?: SelectionStripOptions
  ): SelectionShape {
    const start = clonePoint(point);
    this.activePointerId = pointerId;
    this.activeMode = mode;
    const stripTool = tool === 'select-horizontal' || tool === 'select-vertical'
      ? tool
      : null;
    this.activeStrip = stripTool && stripOptions
      ? { tool: stripTool, options: { ...stripOptions } }
      : null;
    this.activeDraft = this.activeStrip
      ? selectionStripShape(this.activeStrip.tool, start, this.activeStrip.options)
      : {
          kind: selectionKindForTool(tool),
          points: tool === 'select-free' ? [start] : [start, clonePoint(start)]
        };
    return cloneShape(this.activeDraft);
  }

  move(pointerId: number, point: SelectionPoint): SelectionShape | null {
    if (!this.owns(pointerId) || !this.activeDraft) return null;
    const nextPoint = clonePoint(point);
    if (this.activeStrip) {
      this.activeDraft = selectionStripShape(
        this.activeStrip.tool,
        nextPoint,
        this.activeStrip.options
      );
    } else if (this.activeDraft.kind === 'free') {
      const last = this.activeDraft.points[this.activeDraft.points.length - 1];
      const dx = nextPoint.x - last.x;
      const dy = nextPoint.y - last.y;
      if (dx * dx + dy * dy < 4) return null;
      this.activeDraft = {
        ...this.activeDraft,
        points: [...this.activeDraft.points, nextPoint]
      };
    } else {
      this.activeDraft = {
        ...this.activeDraft,
        points: [this.activeDraft.points[0], nextPoint]
      };
    }
    return cloneShape(this.activeDraft);
  }

  finish(pointerId: number): SelectionGestureFinish | null {
    if (!this.owns(pointerId)) return null;
    const shape = this.activeDraft;
    const mode = this.activeMode;
    this.reset();
    if (shape && selectionShapeIsValid(shape)) {
      return {
        kind: 'apply',
        mode,
        shape: cloneShape(shape)
      };
    }
    return mode === 'replace' ? { kind: 'clear' } : { kind: 'none' };
  }

  cancel(pointerId?: number): boolean {
    if (pointerId !== undefined && !this.owns(pointerId)) return false;
    const hadGesture = this.activePointerId !== null || this.activeDraft !== null;
    this.reset();
    return hadGesture;
  }

  reset(): void {
    this.activePointerId = null;
    this.activeDraft = null;
    this.activeMode = 'replace';
    this.activeStrip = null;
  }
}
