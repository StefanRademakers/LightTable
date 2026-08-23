export const DOCUMENT_FIRST_PIXEL_TARGET_MS = 500;

export type DocumentStartupTimelineStage =
  | 'file-selected'
  | 'bytes-available'
  | 'svg-parse-begin'
  | 'svg-parse-end'
  | 'usvg-normalization-begin'
  | 'usvg-normalization-end'
  | 'canonical-object-creation-begin'
  | 'canonical-object-creation-end'
  | 'document-publish'
  | 'gpu-device-requested'
  | 'gpu-adapter-ready'
  | 'gpu-device-ready'
  | 'vello-runtime-ready'
  | 'first-island-submission'
  | 'first-gpu-queue-submission'
  | 'first-compositor-submission'
  | 'request-animation-frame'
  | 'canvas-presentation'
  | 'first-pixel-visible';

export interface DocumentStartupTimelineEvent {
  readonly stage: DocumentStartupTimelineStage;
  readonly elapsedMs: number;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DocumentStartupTimelineSnapshot {
  readonly targetMs: number;
  readonly complete: boolean;
  readonly firstPixelVisibleMs: number | null;
  readonly targetMet: boolean | null;
  readonly events: readonly DocumentStartupTimelineEvent[];
}

/**
 * Monotonic, React-free trace for one explicit document-open intent.
 *
 * Renderer/import services may only append their first occurrence of a stage.
 * The trace is diagnostics derived from an open operation, never document data.
 */
export class DocumentStartupTimeline {
  private readonly startedAt: number;
  private readonly events = new Map<DocumentStartupTimelineStage, DocumentStartupTimelineEvent>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    startedAt?: number
  ) {
    this.startedAt = startedAt ?? this.now();
    this.mark('file-selected');
  }

  mark(
    stage: DocumentStartupTimelineStage,
    detail?: DocumentStartupTimelineEvent['detail']
  ): number {
    const existing = this.events.get(stage);
    if (existing) return existing.elapsedMs;
    const event: DocumentStartupTimelineEvent = {
      stage,
      elapsedMs: Math.max(0, this.now() - this.startedAt),
      ...(detail ? { detail: { ...detail } } : {})
    };
    this.events.set(stage, event);
    return event.elapsedMs;
  }

  has(stage: DocumentStartupTimelineStage): boolean {
    return this.events.has(stage);
  }

  snapshot(): DocumentStartupTimelineSnapshot {
    const events = [...this.events.values()].sort((left, right) => left.elapsedMs - right.elapsedMs);
    const firstPixelVisibleMs = this.events.get('first-pixel-visible')?.elapsedMs ?? null;
    return {
      targetMs: DOCUMENT_FIRST_PIXEL_TARGET_MS,
      complete: firstPixelVisibleMs !== null,
      firstPixelVisibleMs,
      targetMet: firstPixelVisibleMs === null ? null : firstPixelVisibleMs < DOCUMENT_FIRST_PIXEL_TARGET_MS,
      events
    };
  }
}
