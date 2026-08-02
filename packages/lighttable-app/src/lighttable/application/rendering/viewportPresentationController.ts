import {
  resolveViewportRenderState,
  viewportRenderStatesEqual,
  type ViewportRenderRect,
  type ViewportRenderState
} from './viewportRenderState';

export type ViewportSampling = 'linear' | 'nearest';

interface ViewportPresentationPorts {
  writeViewport(uniforms: Float32Array<ArrayBuffer>): void;
  invalidateViewport(): void;
  requestRender(): void;
}

interface ViewportPresentationOptions {
  settleDelayMs?: number;
  schedule?: typeof globalThis.setTimeout;
  cancel?: typeof globalThis.clearTimeout;
}

/**
 * Owns the presentation-only state of a document viewport.
 *
 * The controller deliberately knows nothing about document composition. It
 * converts DOM measurements to GPU uniforms and switches from smooth sampling
 * during interaction to pixel-accurate sampling after zoom settles. Keeping
 * the timer and its disposal here prevents viewport lifecycle state from
 * leaking into the document render graph.
 */
export class ViewportPresentationController {
  private readonly settleDelayMs: number;
  private readonly schedule: typeof globalThis.setTimeout;
  private readonly cancel: typeof globalThis.clearTimeout;
  private currentState: ViewportRenderState | null = null;
  private currentSampling: ViewportSampling = 'linear';
  private currentScale = Number.NaN;
  private settleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ports: ViewportPresentationPorts,
    options: ViewportPresentationOptions = {}
  ) {
    this.settleDelayMs = options.settleDelayMs ?? 75;
    this.schedule = options.schedule ?? globalThis.setTimeout.bind(globalThis);
    this.cancel = options.cancel ?? globalThis.clearTimeout.bind(globalThis);
  }

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
    if (!Number.isFinite(this.currentScale) || Math.abs(scale - this.currentScale) > 0.0001) {
      this.currentScale = scale;
      this.beginInteractiveSampling(scale);
    }

    const nextState = resolveViewportRenderState(
      cssWidth,
      cssHeight,
      devicePixelRatio,
      rect
    );
    if (viewportRenderStatesEqual(this.currentState, nextState)) return false;
    this.currentState = nextState;
    if (this.canvas.width !== nextState.pixelWidth) this.canvas.width = nextState.pixelWidth;
    if (this.canvas.height !== nextState.pixelHeight) this.canvas.height = nextState.pixelHeight;
    this.ports.writeViewport(nextState.uniforms);
    this.invalidateAndRender();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.settleTimer !== null) {
      this.cancel(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private beginInteractiveSampling(scale: number) {
    if (this.settleTimer !== null) this.cancel(this.settleTimer);
    this.setSampling('linear');
    this.settleTimer = this.schedule(() => {
      this.settleTimer = null;
      if (!this.disposed) this.setSampling(scale >= 4 ? 'nearest' : 'linear');
    }, this.settleDelayMs);
  }

  private setSampling(sampling: ViewportSampling) {
    if (this.currentSampling === sampling) return;
    this.currentSampling = sampling;
    this.invalidateAndRender();
  }

  private invalidateAndRender() {
    this.ports.invalidateViewport();
    this.ports.requestRender();
  }
}
