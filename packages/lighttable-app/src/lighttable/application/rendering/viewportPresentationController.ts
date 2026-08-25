import {
  resolveViewportRenderState,
  viewportRenderStatesEqual,
  type ViewportRenderRect,
  type ViewportRenderState
} from './viewportRenderState';

export type ViewportSampling = 'linear' | 'nearest';

export interface ViewportResizeTransition {
  /** A short presentation-only settlement after an interactive dock resize. */
  durationMs?: number;
  /** Keeps the old document position stable when the viewport origin moved. */
  fromOffsetX?: number;
  fromOffsetY?: number;
}

/** At four screen pixels per image pixel, pixel structure becomes intentional. */
export const PIXEL_ACCURATE_SAMPLING_SCALE = 4;

interface ViewportPresentationPorts {
  writeViewport(uniforms: Float32Array<ArrayBuffer>): void;
  invalidateViewport(): void;
  requestRender(): void;
}

/**
 * Owns the presentation-only state of a document viewport.
 *
 * The controller deliberately knows nothing about document composition. It
 * converts DOM measurements to GPU uniforms and chooses sampling directly from
 * the current scale. Once individual pixels are intentionally visible, every
 * zoom frame stays pixel-accurate instead of flashing through a temporary
 * smooth presentation and scheduling a second settlement render.
 */
export class ViewportPresentationController {
  private currentState: ViewportRenderState | null = null;
  private currentSampling: ViewportSampling = 'linear';
  private currentRect: ViewportRenderRect | null = null;
  private animationFrame: number | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ports: ViewportPresentationPorts
  ) {}

  get state() {
    return this.currentState;
  }

  get sampling() {
    return this.currentSampling;
  }

  /** Re-publishes retained uniforms after the GPU resource owner is replaced. */
  syncCurrentState() {
    if (this.disposed || !this.currentState) return false;
    this.ports.writeViewport(this.currentState.uniforms);
    return true;
  }

  resize(
    metadataWidth: number | null,
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    rect: ViewportRenderRect,
    transition: ViewportResizeTransition = {}
  ) {
    if (this.disposed) return false;
    this.cancelAnimation();
    const scale = metadataWidth ? rect.width / metadataWidth : 1;
    const nextSampling: ViewportSampling = scale >= PIXEL_ACCURATE_SAMPLING_SCALE
      ? 'nearest'
      : 'linear';

    const transitionMs = Math.max(0, transition.durationMs ?? 0);
    const previousRect = this.currentRect;
    if (transitionMs > 0 && previousRect) {
      const startRect = {
        x: previousRect.x + (transition.fromOffsetX ?? 0),
        y: previousRect.y + (transition.fromOffsetY ?? 0),
        width: previousRect.width,
        height: previousRect.height
      };
      if (!viewportRectsEqual(startRect, rect)) {
        const startedAt = performance.now();
        this.publishState(cssWidth, cssHeight, devicePixelRatio, startRect, nextSampling);
        const animate = (now: number) => {
          if (this.disposed) return;
          const progress = Math.min(1, Math.max(0, (now - startedAt) / transitionMs));
          const eased = 1 - Math.pow(1 - progress, 3);
          this.publishState(
            cssWidth,
            cssHeight,
            devicePixelRatio,
            interpolateViewportRect(startRect, rect, eased),
            nextSampling
          );
          if (progress < 1) {
            this.animationFrame = window.requestAnimationFrame(animate);
          } else {
            this.animationFrame = null;
          }
        };
        this.animationFrame = window.requestAnimationFrame(animate);
        return true;
      }
    }

    return this.publishState(cssWidth, cssHeight, devicePixelRatio, rect, nextSampling);
  }

  private publishState(
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    rect: ViewportRenderRect,
    sampling: ViewportSampling
  ) {
    const nextState = resolveViewportRenderState(cssWidth, cssHeight, devicePixelRatio, rect);
    const samplingChanged = sampling !== this.currentSampling;
    const stateChanged = !viewportRenderStatesEqual(this.currentState, nextState);
    if (!stateChanged && !samplingChanged) return false;

    this.currentSampling = sampling;
    this.currentRect = rect;
    if (stateChanged) {
      this.currentState = nextState;
      if (this.canvas.width !== nextState.pixelWidth) this.canvas.width = nextState.pixelWidth;
      if (this.canvas.height !== nextState.pixelHeight) this.canvas.height = nextState.pixelHeight;
      this.ports.writeViewport(nextState.uniforms);
    }
    this.invalidateAndRender();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAnimation();
  }

  private cancelAnimation() {
    if (this.animationFrame === null) return;
    window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private invalidateAndRender() {
    this.ports.invalidateViewport();
    this.ports.requestRender();
  }
}

const viewportRectsEqual = (left: ViewportRenderRect, right: ViewportRenderRect) => (
  left.x === right.x
  && left.y === right.y
  && left.width === right.width
  && left.height === right.height
);

export const interpolateViewportRect = (
  from: ViewportRenderRect,
  to: ViewportRenderRect,
  progress: number
): ViewportRenderRect => {
  const amount = Math.min(1, Math.max(0, progress));
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    width: from.width + (to.width - from.width) * amount,
    height: from.height + (to.height - from.height) * amount
  };
};
