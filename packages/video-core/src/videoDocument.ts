export type VideoDocumentId = string & { readonly __videoDocumentId: unique symbol };

export type VideoDocumentLifecycle =
  | 'opening'
  | 'ready'
  | 'failed'
  | 'closing'
  | 'disposed';

/**
 * Durable source identity without a filesystem path or browser object URL.
 * Hosts resolve the opaque source id to a bounded, seekable media resource.
 */
export interface VideoDocumentSource {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly projectId?: string;
  readonly assetId?: string;
}

export interface VideoMetadata {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly frameRate?: number;
  readonly codec?: string;
  readonly hasAudio?: boolean;
}

/** Presentation state is retained across tab switches but never dirties media. */
export interface VideoPresentationState {
  readonly currentTimeSeconds: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly playbackRate: number;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface VideoDocumentSnapshot {
  readonly id: VideoDocumentId;
  readonly kind: 'video';
  readonly source: VideoDocumentSource;
  readonly lifecycle: VideoDocumentLifecycle;
  readonly lifecycleError: string | null;
  readonly metadata: VideoMetadata | null;
  readonly presentation: VideoPresentationState;
  /** Read-only video viewing and playback never create document edits. */
  readonly dirty: false;
}

export const DEFAULT_VIDEO_PRESENTATION: VideoPresentationState = {
  currentTimeSeconds: 0,
  paused: true,
  muted: false,
  volume: 1,
  playbackRate: 1,
  zoom: 1,
  panX: 0,
  panY: 0
};

const finiteAtLeast = (value: number, minimum: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(minimum, value) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const normalizeVideoMetadata = (metadata: VideoMetadata): VideoMetadata => ({
  width: Math.max(1, Math.round(finiteAtLeast(metadata.width, 1, 1))),
  height: Math.max(1, Math.round(finiteAtLeast(metadata.height, 1, 1))),
  durationSeconds: finiteAtLeast(metadata.durationSeconds, 0, 0),
  ...(metadata.frameRate === undefined
    ? {}
    : { frameRate: finiteAtLeast(metadata.frameRate, 0, 0) }),
  ...(metadata.codec === undefined ? {} : { codec: metadata.codec }),
  ...(metadata.hasAudio === undefined ? {} : { hasAudio: metadata.hasAudio })
});

export const normalizeVideoPresentation = (
  presentation: VideoPresentationState,
  durationSeconds = Number.POSITIVE_INFINITY
): VideoPresentationState => ({
  currentTimeSeconds: clamp(
    finiteAtLeast(presentation.currentTimeSeconds, 0, 0),
    0,
    finiteAtLeast(durationSeconds, 0, Number.POSITIVE_INFINITY)
  ),
  paused: presentation.paused,
  muted: presentation.muted,
  volume: clamp(Number.isFinite(presentation.volume) ? presentation.volume : 1, 0, 1),
  playbackRate: clamp(Number.isFinite(presentation.playbackRate) ? presentation.playbackRate : 1, 0.1, 16),
  zoom: clamp(Number.isFinite(presentation.zoom) ? presentation.zoom : 1, 0.01, 256),
  panX: Number.isFinite(presentation.panX) ? presentation.panX : 0,
  panY: Number.isFinite(presentation.panY) ? presentation.panY : 0
});
