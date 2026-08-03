import type { LayerId } from '../../editor/document/documentTypes';
import type { TextSelectionRange } from './flowTextEditing';

export interface TextSelectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface TextSelectionGestureDependencies {
  focusAt(layerId: LayerId, point: TextSelectionPoint): number | null;
  publishSelection(selection: TextSelectionRange, transient: boolean): void;
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

interface ActiveTextSelectionGesture {
  readonly pointerId: number;
  readonly layerId: LayerId;
  readonly anchor: number;
  pendingFocus: number | null;
  frame: number | null;
}

/** Coalesces high-frequency text drag selection into one transient update per frame. */
export class TextSelectionGestureController {
  private active: ActiveTextSelectionGesture | null = null;

  constructor(
    private readonly dependencies: () => TextSelectionGestureDependencies
  ) {}

  begin(pointerId: number, layerId: LayerId, anchor: number) {
    this.cancelActiveFrame();
    this.active = { pointerId, layerId, anchor, pendingFocus: null, frame: null };
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
      this.dependencies().publishSelection({
        anchor: current.anchor,
        focus: current.pendingFocus
      }, true);
      current.pendingFocus = null;
    });
    return true;
  }

  finish(pointerId: number, point: TextSelectionPoint) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const focus = this.dependencies().focusAt(active.layerId, point)
      ?? active.pendingFocus
      ?? active.anchor;
    this.cancelActiveFrame();
    this.active = null;
    this.dependencies().publishSelection({ anchor: active.anchor, focus }, false);
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
}
