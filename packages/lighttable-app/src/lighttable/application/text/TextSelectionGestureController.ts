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
  captureScope(layerId: LayerId): { isCurrent(): boolean } | null;
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
  readonly dependencies: TextSelectionGestureDependencies;
  readonly scope: { isCurrent(): boolean };
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
    this.dispose();
    const dependencies = this.dependencies(), scope = dependencies.captureScope(layerId);
    if (!scope?.isCurrent()) return false;
    this.active = { pointerId, layerId, anchorRange: { ...anchorRange }, granularity,
      dependencies, scope, pendingFocus: null, frame: null };
    return true;
  }

  owns(pointerId: number) {
    return this.active?.pointerId === pointerId;
  }

  move(pointerId: number, point: TextSelectionPoint) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    if (!active.scope.isCurrent()) { this.dispose(); return false; }
    const focus = active.dependencies.focusAt(active.layerId, point);
    if (this.active !== active || !active.scope.isCurrent()) return false;
    if (focus === null) return false;
    active.pendingFocus = focus;
    if (active.frame !== null) return true;
    active.frame = active.dependencies.requestFrame(() => {
      if (this.active !== active) return;
      active.frame = null;
      if (!active.scope.isCurrent()) { this.dispose(); return; }
      if (active.pendingFocus === null) return;
      const selection = this.selectionAt(active, active.pendingFocus);
      active.pendingFocus = null;
      if (this.active === active && active.scope.isCurrent()) active.dependencies.publishSelection(selection, true);
    });
    return true;
  }

  finish(pointerId: number, point: TextSelectionPoint) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    if (!active.scope.isCurrent()) { this.dispose(); return false; }
    const focus = active.dependencies.focusAt(active.layerId, point)
      ?? active.pendingFocus
      ?? active.anchorRange.focus;
    const selection = this.selectionAt(active, focus);
    if (this.active !== active || !active.scope.isCurrent()) return false;
    this.cancelActiveFrame();
    this.active = null;
    active.dependencies.publishSelection(selection, false);
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
    this.active.dependencies.cancelFrame(this.active.frame);
    this.active.frame = null;
  }

  private selectionAt(active: ActiveTextSelectionGesture, focus: number): TextSelectionRange {
    const anchor = orderedTextSelection(active.anchorRange);
    const target = active.dependencies.rangeAt(active.layerId, focus, active.granularity)
      ?? { anchor: focus, focus };
    const orderedTarget = orderedTextSelection(target);
    return focus < anchor.start
      ? { anchor: anchor.end, focus: orderedTarget.start }
      : { anchor: anchor.start, focus: orderedTarget.end };
  }
}
