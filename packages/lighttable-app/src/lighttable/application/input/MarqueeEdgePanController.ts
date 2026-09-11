import type { ViewportFrameOwner } from './ViewportPresentationController';
import type { Rect } from '../../editor/document/documentTypes';
import type { BrushPoint } from '../../editor/tools/brush/strokeBuilder';
import type { SelectionCombineMode } from '../../editor/selection/selectionTypes';
import { clampEdgePanDelta, edgePanVelocity } from '../../editor/interaction/edgePan';

interface MarqueeEdgePanState {
  readonly pointerId: number;
  clientX: number;
  clientY: number;
  bounds: { left: number; top: number; width: number; height: number };
  imageRect: Rect;
  point: BrushPoint;
  readonly scale: number;
  readonly repositionDraft: boolean;
  readonly marqueeModifiers?: { constrainAspect: boolean; fromCenter: boolean };
  readonly constrainTranslation: boolean;
  lastFrameMs: number;
  readonly owner: ViewportFrameOwner;
}

interface MarqueeEdgePanDependencies {
  readonly isOwnerCurrent: (owner: ViewportFrameOwner) => boolean;
  readonly moveSelection: (
    pointerId: number,
    point: BrushPoint,
    repositionDraft: boolean,
    marqueeModifiers: { constrainAspect: boolean; fromCenter: boolean } | undefined,
    constrainTranslation: boolean
  ) => void;
  readonly setCustomZoomMode: () => void;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly now?: () => number;
}

export interface MarqueeEdgePanUpdate {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly bounds: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly point: BrushPoint;
  readonly activeTool: string;
  readonly selectionEmpty: boolean;
  readonly combineMode: SelectionCombineMode;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly scale: number;
  readonly repositionDraft: boolean;
  readonly owner: ViewportFrameOwner;
}

export class MarqueeEdgePanController {
  private state: MarqueeEdgePanState | null = null;
  private frame: number | null = null;
  private imageRect: Rect;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;

  constructor(initialImageRect: Rect, private readonly dependencies: MarqueeEdgePanDependencies) {
    this.imageRect = { ...initialImageRect };
    this.requestFrame = dependencies.requestFrame ?? requestAnimationFrame;
    this.cancelFrame = dependencies.cancelFrame ?? cancelAnimationFrame;
    this.now = dependencies.now ?? performance.now.bind(performance);
  }

  setImageRect(imageRect: Rect): void {
    if (!this.state) this.imageRect = { ...imageRect };
  }

  get currentImageRect(): Rect {
    return this.state?.imageRect ?? this.imageRect;
  }

  stop(pointerId?: number): void {
    if (pointerId !== undefined && this.state?.pointerId !== pointerId) return;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.state = null;
  }

  dispose(): void {
    this.stop();
  }

  update(input: MarqueeEdgePanUpdate): void {
    if (input.activeTool !== 'select-rectangle' && input.activeTool !== 'select-ellipse') {
      this.stop(input.pointerId);
      return;
    }
    const velocityX = edgePanVelocity(input.clientX, input.bounds.left, input.bounds.width);
    const velocityY = edgePanVelocity(input.clientY, input.bounds.top, input.bounds.height);
    if (velocityX === 0 && velocityY === 0) {
      this.stop(input.pointerId);
      return;
    }
    const marqueeModifiers = input.selectionEmpty && input.combineMode === 'replace'
      ? { constrainAspect: input.shiftKey, fromCenter: input.altKey }
      : undefined;
    if (this.state?.pointerId === input.pointerId) {
      this.state.clientX = input.clientX;
      this.state.clientY = input.clientY;
      this.state.bounds = { ...input.bounds };
      this.state.point = input.point;
      return;
    }
    this.state = {
      pointerId: input.pointerId,
      clientX: input.clientX,
      clientY: input.clientY,
      bounds: { ...input.bounds },
      imageRect: { ...this.imageRect },
      point: input.point,
      scale: input.scale,
      repositionDraft: input.repositionDraft,
      ...(marqueeModifiers ? { marqueeModifiers } : {}),
      constrainTranslation: input.shiftKey,
      lastFrameMs: this.now(),
      owner: input.owner
    };
    if (this.frame === null) {
      this.dependencies.setCustomZoomMode();
      this.frame = this.requestFrame(this.runFrame);
    }
  }

  private readonly runFrame = (frameMs: number): void => {
    this.frame = null;
    const state = this.state;
    if (!state) return;
    if (!this.dependencies.isOwnerCurrent(state.owner)) {
      this.stop(state.pointerId);
      return;
    }
    const elapsedMs = Math.min(Math.max(frameMs - state.lastFrameMs, 0), 32);
    state.lastFrameMs = frameMs;
    const velocityX = edgePanVelocity(state.clientX, state.bounds.left, state.bounds.width);
    const velocityY = edgePanVelocity(state.clientY, state.bounds.top, state.bounds.height);
    if (velocityX === 0 && velocityY === 0) {
      this.state = null;
      return;
    }
    if (elapsedMs === 0) {
      this.frame = this.requestFrame(this.runFrame);
      return;
    }
    const deltaX = clampEdgePanDelta(
      velocityX * elapsedMs / 1_000,
      state.imageRect.x,
      state.imageRect.width,
      state.bounds.width
    );
    const deltaY = clampEdgePanDelta(
      velocityY * elapsedMs / 1_000,
      state.imageRect.y,
      state.imageRect.height,
      state.bounds.height
    );
    if (deltaX === 0 && deltaY === 0) {
      this.state = null;
      return;
    }
    state.imageRect = {
      ...state.imageRect,
      x: state.imageRect.x + deltaX,
      y: state.imageRect.y + deltaY
    };
    this.imageRect = state.imageRect;
    state.point = {
      ...state.point,
      x: state.point.x - deltaX / Math.max(state.scale, 1e-6),
      y: state.point.y - deltaY / Math.max(state.scale, 1e-6)
    };
    state.owner.setView((current) => ({
      ...current,
      panX: current.panX + deltaX,
      panY: current.panY + deltaY
    }));
    this.dependencies.moveSelection(
      state.pointerId,
      state.point,
      state.repositionDraft,
      state.marqueeModifiers,
      state.constrainTranslation
    );
    this.frame = this.requestFrame(this.runFrame);
  };
}
