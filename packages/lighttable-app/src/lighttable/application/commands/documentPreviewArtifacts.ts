import type { DocumentSessionId } from '../documents/documentSession';
import type {
  LightTableArtifactMetadata,
  LightTablePreviewArtifactContext
} from './lightTableArtifactRegistry';
import type { LightTablePreviewEncoding } from './lightTableCommandContract';
import { planDocumentRegionPreview, type DocumentPixelRegion } from '../../editor/geometry/documentRegionPreview';

export const MIN_AGENT_PREVIEW_EDGE = 64;
export const MAX_AGENT_PREVIEW_EDGE = 1024;

export type DocumentPreviewResult =
  | { readonly status: 'completed'; readonly artifact: LightTableArtifactMetadata;
      readonly reused: boolean }
  | { readonly status: 'rejected';
      readonly code: 'invalid-request' | 'document-not-ready' | 'stale-document-revision'
        | 'renderer-unavailable';
      readonly message: string; readonly currentRevision?: number };

interface PreviewDocumentSnapshot {
  readonly lifecycle: string;
  readonly canonicalRevision: number;
  readonly width: number;
  readonly height: number;
}

export interface DocumentPreviewArtifactDependencies {
  snapshot(documentId: DocumentSessionId): PreviewDocumentSnapshot | null;
  render(documentId: DocumentSessionId, maxEdge: number, encoding: LightTablePreviewEncoding,
    region?: DocumentPixelRegion): Promise<File>;
  register(file: File, context: LightTablePreviewArtifactContext): LightTableArtifactMetadata;
  query(artifactId: string): LightTableArtifactMetadata | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const previewDimensions = (width: number, height: number, maxEdge: number) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};

export const parsePreviewEncoding = (value: Record<string, unknown>): LightTablePreviewEncoding | null => {
  const format = value.format ?? 'png';
  const quality = value.quality;
  if (format !== 'png' && format !== 'webp') return null;
  if (format === 'png') return quality === undefined ? { format } : null;
  if (quality !== undefined && (typeof quality !== 'number' || !Number.isFinite(quality)
    || quality < 0.1 || quality > 1)) return null;
  return { format, quality: (quality as number | undefined) ?? 0.85 };
};

const parseRegion = (value: unknown): DocumentPixelRegion | null | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  return [x, y, width, height].every((item) => typeof item === 'number' && Number.isFinite(item))
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : null;
};

/**
 * Revision gate and cache for bounded agent previews. Rendering remains owned
 * by the mounted document renderer; this controller never touches viewport or
 * interactive gesture state.
 */
export class DocumentPreviewArtifactController {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<DocumentPreviewResult>>();
  private generation = 0;

  constructor(private readonly dependencies: DocumentPreviewArtifactDependencies) {}

  request(value: unknown): Promise<DocumentPreviewResult> {
    const expected = isRecord(value) && typeof value.expectedDocumentRevision === 'number'
      ? value.expectedDocumentRevision : null;
    const requestedEdge = isRecord(value) && typeof value.maxEdge === 'number'
      ? value.maxEdge : value && isRecord(value) && value.maxEdge === undefined ? undefined : null;
    const encoding = isRecord(value) ? parsePreviewEncoding(value) : null;
    const region = isRecord(value) ? parseRegion(value.region) : null;
    if (!isRecord(value) || typeof value.documentId !== 'string'
      || expected === null || !Number.isSafeInteger(expected) || expected < 0
      || requestedEdge === null || !encoding || region === null
      || (requestedEdge !== undefined && (!Number.isInteger(requestedEdge)
        || requestedEdge < MIN_AGENT_PREVIEW_EDGE || requestedEdge > MAX_AGENT_PREVIEW_EDGE))) {
      return Promise.resolve({ status: 'rejected', code: 'invalid-request',
        message: `Preview requires documentId, expectedDocumentRevision, maxEdge ${MIN_AGENT_PREVIEW_EDGE}-${MAX_AGENT_PREVIEW_EDGE}, and PNG or WebP encoding (WebP quality 0.1-1).` });
    }
    const documentId = value.documentId as DocumentSessionId;
    const expectedRevision = expected;
    const maxEdge = requestedEdge ?? MAX_AGENT_PREVIEW_EDGE;
    const opening = this.dependencies.snapshot(documentId);
    if (!opening || opening.lifecycle !== 'ready') {
      return Promise.resolve({ status: 'rejected', code: 'document-not-ready',
        message: 'The preview document is not ready.' });
    }
    if (opening.canonicalRevision !== expectedRevision) {
      return Promise.resolve({ status: 'rejected', code: 'stale-document-revision',
        message: 'The expected document revision is stale.',
        currentRevision: opening.canonicalRevision });
    }
    const regionPlan = region ? planDocumentRegionPreview(
      opening.width, opening.height, region, maxEdge
    ) : null;
    if (region && !regionPlan) return Promise.resolve({ status: 'rejected', code: 'invalid-request',
      message: 'Preview region must be finite, non-empty and inside the document.' });
    const regionKey = region ? `${region.x},${region.y},${region.width},${region.height}` : 'document';
    const key = `${documentId}:${expectedRevision}:${maxEdge}:${regionKey}:${encoding.format}:${encoding.quality ?? 'lossless'}`;
    const cached = this.cache.get(key);
    const artifact = cached ? this.dependencies.query(cached) : null;
    if (artifact?.kind === 'render-preview') {
      return Promise.resolve({ status: 'completed', artifact, reused: true });
    }
    if (cached) this.cache.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    let request!: Promise<DocumentPreviewResult>;
    request = this.render(documentId, expectedRevision, maxEdge, encoding, region, key, this.generation)
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  invalidateArtifact(artifactId: string): void {
    for (const [key, cached] of this.cache) {
      if (cached === artifactId) this.cache.delete(key);
    }
  }

  clear(): void {
    this.generation += 1;
    this.cache.clear();
    this.inFlight.clear();
  }

  private async render(documentId: DocumentSessionId, expectedRevision: number,
    maxEdge: number, encoding: LightTablePreviewEncoding, region: DocumentPixelRegion | undefined,
    key: string,
    generation: number): Promise<DocumentPreviewResult> {
    let file: File;
    try {
      file = await this.dependencies.render(documentId, maxEdge, encoding, region);
    } catch (reason) {
      return { status: 'rejected', code: 'renderer-unavailable',
        message: reason instanceof Error ? reason.message : 'The document preview renderer is unavailable.' };
    }
    if (generation !== this.generation) {
      return { status: 'rejected', code: 'document-not-ready',
        message: 'The preview owner was disposed during rendering.' };
    }
    const closing = this.dependencies.snapshot(documentId);
    if (!closing || closing.lifecycle !== 'ready') {
      return { status: 'rejected', code: 'document-not-ready',
        message: 'The preview document closed during rendering.' };
    }
    if (closing.canonicalRevision !== expectedRevision) {
      return { status: 'rejected', code: 'stale-document-revision',
        message: 'The document changed while its preview was rendering.',
        currentRevision: closing.canonicalRevision };
    }
    const regionPlan = region ? planDocumentRegionPreview(
      closing.width, closing.height, region, maxEdge
    ) : null;
    const dimensions = regionPlan ? { width: regionPlan.outputWidth, height: regionPlan.outputHeight }
      : previewDimensions(closing.width, closing.height, maxEdge);
    const artifact = this.dependencies.register(file, {
      documentId,
      canonicalRevision: expectedRevision,
      ...dimensions,
      maxEdge, format: encoding.format, ...(encoding.quality === undefined ? {} : { quality: encoding.quality }),
      ...(region ? { target: { kind: 'region' as const, coordinateSpace: 'document-px' as const,
        bounds: { ...region } } } : {})
    });
    this.cache.set(key, artifact.id);
    return { status: 'completed', artifact, reused: false };
  }
}
