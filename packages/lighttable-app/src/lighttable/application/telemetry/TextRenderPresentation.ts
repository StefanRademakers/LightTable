import type { TextRenderPresentationSnapshot } from '../rendering/rendererTypes';

export type TextRenderPresentationPublisher = (
  snapshot: TextRenderPresentationSnapshot, sourceIsCurrent: () => boolean
) => void;

export type TextRenderTraceSink = (
  severity: 'info' | 'error', source: string, message: string, details?: string
) => void;

export const createInitialTextRenderPresentation = (): TextRenderPresentationSnapshot => ({
  publicationRevision: 0, readyLayerCount: 0, textureBytes: 0,
  mode: 'placeholder', rebuildingLayerCount: 0,
  cacheBudgetBytes: 256 * 1024 * 1024, cacheEvictions: 0,
  atlasLayerCount: 0, cachedLayerCount: 0, atlasEncodes: 0,
  sourceCacheHits: 0, sourceCacheMisses: 0,
  layoutCacheBytes: 0, layoutCacheBudgetBytes: 32 * 1024 * 1024,
  layoutCacheHits: 0, layoutCacheMisses: 0, layoutCacheEvictions: 0,
  atlasBytes: 0, atlasHits: 0, atlasMisses: 0, atlasEvictions: 0,
  sourceDecisionMeasurements: 0, lastSourceDecision: null,
  coordinatorActive: true, configuredFontCount: 0, visibleTextLayerCount: 0,
  preparationStage: 'waiting-document', preparationLayerId: null, lastPreparationError: null,
  traceRevision: 0, traceMessage: null, traceDetails: null,
  shapingOperations: 0, latestShapingRoundTripMs: 0,
  rasterizedGlyphs: 0, latestRasterRoundTripMs: 0, textCacheSubmissions: 0,
  textInputLatencySamples: 0, pendingTextInputs: 0, supersededTextInputs: 0,
  inputToSubmitP95Ms: 0, inputToSubmitMaxMs: 0,
  inputToGpuP95Ms: 0, inputToGpuMaxMs: 0
});

interface PendingPresentation {
  readonly snapshot: TextRenderPresentationSnapshot;
  readonly sourceIsCurrent: () => boolean;
  readonly epoch: number;
}

/** UI/diagnostic projection only. Text realization and its revisions stay renderer-owned. */
export class TextRenderPresentation {
  private snapshot = createInitialTextRenderPresentation();
  private readonly listeners = new Set<() => void>();
  private connection: { readonly trace: TextRenderTraceSink } | null = null;
  private frame: { handle: number } | null = null;
  private pending: PendingPresentation | null = null;
  private epoch = 0;
  private traceSignature = '';

  constructor(private readonly frames: {
    request(callback: () => void): number;
    cancel(handle: number): void;
  }) {}

  readonly getSnapshot = (): TextRenderPresentationSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The composition's layout lifetime supplies diagnostics before open callbacks can arrive. */
  connect(trace: TextRenderTraceSink): () => void {
    this.invalidatePending();
    const connection = { trace };
    this.connection = connection;
    return () => {
      if (this.connection !== connection) return;
      this.connection = null;
      this.invalidatePending();
    };
  }

  readonly receive: TextRenderPresentationPublisher = (snapshot, sourceIsCurrent) => {
    if (!this.connection || !sourceIsCurrent()) return;
    // beforeOpen resets after constructing the request: capture the epoch on receipt, not binding.
    this.pending = { snapshot, sourceIsCurrent, epoch: this.epoch };
    if (this.frame) return;
    const frame = { handle: 0 };
    this.frame = frame;
    frame.handle = this.frames.request(() => {
      if (this.frame !== frame) return;
      this.frame = null;
      const pending = this.pending;
      this.pending = null;
      const connection = this.connection;
      if (!pending || !connection || !this.isCurrent(pending)) return;
      this.snapshot = pending.snapshot;
      this.notify();
      // A subscriber may synchronously reset or retire this presentation.
      if (this.connection !== connection || !this.isCurrent(pending)) return;
      const latest = pending.snapshot;
      if (!latest.traceMessage) return;
      const signature = `${latest.traceRevision}:${latest.traceMessage}:${latest.traceDetails ?? ''}`;
      if (this.traceSignature === signature) return;
      this.traceSignature = signature;
      connection.trace(latest.preparationStage === 'failed' ? 'error' : 'info',
        'GPU text pipeline', latest.traceMessage, latest.traceDetails ?? undefined);
    });
  };

  readonly reset = (): void => {
    this.invalidatePending();
    this.traceSignature = '';
    this.snapshot = createInitialTextRenderPresentation();
    this.notify();
  };

  private isCurrent(pending: PendingPresentation): boolean {
    return pending.epoch === this.epoch && pending.sourceIsCurrent();
  }

  private invalidatePending(): void {
    this.epoch += 1;
    if (this.frame) this.frames.cancel(this.frame.handle);
    this.frame = null;
    this.pending = null;
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
