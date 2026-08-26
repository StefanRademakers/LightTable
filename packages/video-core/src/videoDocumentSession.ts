import {
  DEFAULT_VIDEO_PLAYBACK_TELEMETRY,
  DEFAULT_VIDEO_PRESENTATION,
  normalizeVideoMetadata,
  normalizeVideoPresentation,
  type VideoDocumentId,
  type VideoDocumentSnapshot,
  type VideoDocumentSource,
  type VideoMetadata,
  type VideoPlaybackTelemetry,
  type VideoPresentationState
} from './videoDocument';

export type VideoDocumentListener = () => void;

export interface CreateVideoDocumentSessionOptions {
  readonly id: VideoDocumentId;
  readonly source: VideoDocumentSource;
  readonly presentation?: Partial<VideoPresentationState>;
}

/**
 * Host- and UI-neutral owner of one read-only video document. Playback and
 * viewport changes are presentation state: they notify observers but never
 * create a canonical revision, history entry or dirty document.
 */
export class VideoDocumentSession {
  private readonly listeners = new Set<VideoDocumentListener>();
  private readonly playbackTelemetryListeners = new Set<VideoDocumentListener>();
  private snapshot: VideoDocumentSnapshot;
  private playbackTelemetry: VideoPlaybackTelemetry = DEFAULT_VIDEO_PLAYBACK_TELEMETRY;

  constructor(options: CreateVideoDocumentSessionOptions) {
    this.snapshot = {
      id: options.id,
      kind: 'video',
      source: structuredClone(options.source),
      lifecycle: 'opening',
      lifecycleError: null,
      metadata: null,
      presentation: normalizeVideoPresentation({
        ...DEFAULT_VIDEO_PRESENTATION,
        ...options.presentation
      }),
      dirty: false
    };
  }

  get id(): VideoDocumentId {
    return this.snapshot.id;
  }

  getSnapshot = (): VideoDocumentSnapshot => this.snapshot;

  subscribe = (listener: VideoDocumentListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPlaybackTelemetrySnapshot = (): VideoPlaybackTelemetry => this.playbackTelemetry;

  subscribePlaybackTelemetry = (listener: VideoDocumentListener): (() => void) => {
    this.playbackTelemetryListeners.add(listener);
    return () => this.playbackTelemetryListeners.delete(listener);
  };

  /** Renderer/runtime telemetry; intentionally does not publish document state. */
  publishPlaybackTelemetry(telemetry: VideoPlaybackTelemetry): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    if (
      telemetry.status === this.playbackTelemetry.status
      && telemetry.actualFramesPerSecond === this.playbackTelemetry.actualFramesPerSecond
      && telemetry.targetFramesPerSecond === this.playbackTelemetry.targetFramesPerSecond
      && telemetry.droppedFrames === this.playbackTelemetry.droppedFrames
      && telemetry.belowTarget === this.playbackTelemetry.belowTarget
    ) return;
    this.playbackTelemetry = telemetry;
    for (const listener of this.playbackTelemetryListeners) listener();
  }

  publishReady(metadata: VideoMetadata): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    const normalized = normalizeVideoMetadata(metadata);
    this.publish({
      ...this.snapshot,
      lifecycle: 'ready',
      lifecycleError: null,
      metadata: normalized,
      presentation: normalizeVideoPresentation(
        this.snapshot.presentation,
        normalized.durationSeconds
      )
    });
  }

  publishFailure(message: string): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    this.publish({
      ...this.snapshot,
      lifecycle: 'failed',
      lifecycleError: message || 'Video could not be opened.',
      presentation: { ...this.snapshot.presentation, paused: true }
    });
  }

  updatePresentation(update: Partial<VideoPresentationState>): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    const next = normalizeVideoPresentation(
      { ...this.snapshot.presentation, ...update },
      this.snapshot.metadata?.durationSeconds
    );
    if (Object.keys(next).every((key) =>
      next[key as keyof VideoPresentationState]
        === this.snapshot.presentation[key as keyof VideoPresentationState])) return;
    this.publish({ ...this.snapshot, presentation: next });
  }

  beginClose(): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    this.publish({
      ...this.snapshot,
      lifecycle: 'closing',
      presentation: { ...this.snapshot.presentation, paused: true }
    });
  }

  dispose(): void {
    if (this.snapshot.lifecycle === 'disposed') return;
    this.snapshot = {
      ...this.snapshot,
      lifecycle: 'disposed',
      presentation: { ...this.snapshot.presentation, paused: true }
    };
    for (const listener of this.listeners) listener();
    this.listeners.clear();
    this.playbackTelemetry = DEFAULT_VIDEO_PLAYBACK_TELEMETRY;
    this.playbackTelemetryListeners.clear();
  }

  private publish(snapshot: VideoDocumentSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
