import {
  selectionModeFromModifiers,
  selectionShapeIsValid,
  type SelectionMode,
  type SelectionPoint,
  type SelectionShape,
  type SelectionToolId
} from '../../selection/selectionTypes';
import { selectionKindForTool } from '../toolCapabilities';

export type SelectionGestureFinish =
  | { kind: 'apply'; mode: SelectionMode; shape: SelectionShape }
  | { kind: 'clear' }
  | { kind: 'none' };

const clonePoint = (point: SelectionPoint): SelectionPoint => ({ ...point });

const cloneShape = (shape: SelectionShape): SelectionShape => ({
  ...shape,
  points: shape.points.map(clonePoint)
});

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

  get pointerId(): number | null {
    return this.activePointerId;
  }

  get draft(): SelectionShape | null {
    return this.activeDraft ? cloneShape(this.activeDraft) : null;
  }

  owns(pointerId: number): boolean {
    return this.activePointerId === pointerId;
  }

  begin(pointerId: number, tool: SelectionToolId, point: SelectionPoint): SelectionShape {
    const start = clonePoint(point);
    this.activePointerId = pointerId;
    this.activeDraft = {
      kind: selectionKindForTool(tool),
      points: tool === 'select-free' ? [start] : [start, clonePoint(start)]
    };
    return cloneShape(this.activeDraft);
  }

  move(pointerId: number, point: SelectionPoint): SelectionShape | null {
    if (!this.owns(pointerId) || !this.activeDraft) return null;
    const nextPoint = clonePoint(point);
    if (this.activeDraft.kind === 'free') {
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

  finish(
    pointerId: number,
    modifiers: { shiftKey: boolean; altKey: boolean }
  ): SelectionGestureFinish | null {
    if (!this.owns(pointerId)) return null;
    const shape = this.activeDraft;
    this.reset();
    if (shape && selectionShapeIsValid(shape)) {
      return {
        kind: 'apply',
        mode: selectionModeFromModifiers(modifiers.shiftKey, modifiers.altKey),
        shape: cloneShape(shape)
      };
    }
    return !modifiers.shiftKey && !modifiers.altKey
      ? { kind: 'clear' }
      : { kind: 'none' };
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
  }
}
