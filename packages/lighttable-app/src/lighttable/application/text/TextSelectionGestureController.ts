import type { LayerId } from '../../editor/document/documentTypes';
import {
  orderedTextSelection,
  type TextSelectionGranularity,
  type TextSelectionRange
} from './flowTextEditing';

export interface TextSelectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface TextSelectionGestureDependencies {
  focusAt(layerId: LayerId, point: TextSelectionPoint): number | null;
  rangeAt(
    layerId: LayerId,
    offset: number,
    granularity: TextSelectionGranularity
  ): TextSelectionRange | null;
  publishSelection(selection: TextSelectionRange, transient: boolean): void;
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

interface ActiveTextSelectionGesture {
  readonly pointerId: number;
  readonly layerId: LayerId;
  readonly anchorRange: TextSelectionRange;
  readonly granularity: TextSelectionGranularity;
  pendingFocus: number | null;
  frame: number | null;
}

/** Coalesces high-frequency text drag selection into one transient update per frame. */
export class TextSelectionGestureController {
  private active: ActiveTextSelectionGesture | null = null;

  constructor(
    private readonly dependencies: () => TextSelectionGestureDependencies
  ) {}

  begin(
    pointerId: number,
    layerId: LayerId,
    anchorRange: TextSelectionRange,
    granularity: TextSelectionGranularity = 'character'
  ) {
    this.cancelActiveFrame();
    this.active = { pointerId, layerId, anchorRange, granularity, pendingFocus: null, frame: null };
  }

  owns(pointerId: number) {
    return this.active?.pointerId === pointerId;
  }

  move(pointerId: number, point: TextSelectionPoint) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const focus = this.dependencies().focusAt(active.layerId, point);
    if (focus === null) return false;
    active.pendingFocus = focus;
    if (active.frame !== null) return true;
    active.frame = this.dependencies().requestFrame(() => {
      const current = this.active;
      if (!current || current.pointerId !== pointerId) return;
      current.frame = null;
      if (current.pendingFocus === null) return;
      this.dependencies().publishSelection(this.selectionAt(current, current.pendingFocus), true);
      current.pendingFocus = null;
    });
    return true;
  }

  finish(pointerId: number, point: TextSelectionPoint) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const focus = this.dependencies().focusAt(active.layerId, point)
      ?? active.pendingFocus
      ?? active.anchorRange.focus;
    this.cancelActiveFrame();
    this.active = null;
    this.dependencies().publishSelection(this.selectionAt(active, focus), false);
    return true;
  }

  cancel(pointerId: number) {
    if (!this.owns(pointerId)) return false;
    this.cancelActiveFrame();
    this.active = null;
    return true;
  }

  dispose() {
    this.cancelActiveFrame();
    this.active = null;
  }

  private cancelActiveFrame() {
    if (this.active?.frame === null || this.active?.frame === undefined) return;
    this.dependencies().cancelFrame(this.active.frame);
    this.active.frame = null;
  }

  private selectionAt(active: ActiveTextSelectionGesture, focus: number): TextSelectionRange {
    const anchor = orderedTextSelection(active.anchorRange);
    const target = this.dependencies().rangeAt(active.layerId, focus, active.granularity)
      ?? { anchor: focus, focus };
    const orderedTarget = orderedTextSelection(target);
    return focus < anchor.start
      ? { anchor: anchor.end, focus: orderedTarget.start }
      : { anchor: anchor.start, focus: orderedTarget.end };
  }
}
