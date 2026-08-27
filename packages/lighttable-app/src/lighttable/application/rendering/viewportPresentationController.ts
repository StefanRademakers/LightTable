import {
  resolveViewportRenderState,
  viewportRenderStatesEqual,
  type ViewportRenderRect,
  type ViewportRenderState
} from './viewportRenderState';

export type ViewportSampling = 'linear' | 'nearest';

/** At three screen pixels per image pixel, pixel structure becomes intentional. */
export const PIXEL_ACCURATE_SAMPLING_SCALE = 3;

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
    rect: ViewportRenderRect
  ) {
    if (this.disposed) return false;
    const scale = metadataWidth ? rect.width / metadataWidth : 1;
    const nextSampling: ViewportSampling = scale >= PIXEL_ACCURATE_SAMPLING_SCALE
      ? 'nearest'
      : 'linear';
    const samplingChanged = nextSampling !== this.currentSampling;

    const nextState = resolveViewportRenderState(
      cssWidth,
      cssHeight,
      devicePixelRatio,
      rect
    );
    const stateChanged = !viewportRenderStatesEqual(this.currentState, nextState);
    if (!stateChanged && !samplingChanged) return false;

    this.currentSampling = nextSampling;
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
  }

  private invalidateAndRender() {
    this.ports.invalidateViewport();
    this.ports.requestRender();
  }
}
