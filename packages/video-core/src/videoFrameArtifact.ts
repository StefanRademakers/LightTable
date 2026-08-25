import type { VideoDocumentId } from './videoDocument';

export type VideoFramePurpose = 'copy' | 'open-as-document' | 'place-as-layer';

export interface VideoFrameRequest {
  readonly documentId: VideoDocumentId;
  readonly timeSeconds: number;
  readonly purpose: VideoFramePurpose;
  readonly format?: 'image/png' | 'image/webp';
}

/**
 * Host-neutral output of frame decoding. The application owns what happens
 * next: clipboard publication, opening an image document or placing a layer.
 */
export interface VideoFrameArtifact {
  readonly name: string;
  readonly mediaType: 'image/png' | 'image/webp';
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly sourceDocumentId: VideoDocumentId;
  readonly sourceTimeSeconds: number;
}

export interface VideoFrameExtractionPort {
  extractFrame(request: VideoFrameRequest): Promise<VideoFrameArtifact>;
}
