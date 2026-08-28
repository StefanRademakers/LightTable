import type { DocumentSessionId } from '../documents/documentSession';
import type { LayerId } from '../../editor/document/documentTypes';
import type { LightTableLayerPreviewRender } from './lightTableCommandContract';
import type { LightTablePreviewEncoding } from './lightTableCommandContract';
import type { LightTableArtifactMetadata, LightTablePreviewArtifactContext } from './lightTableArtifactRegistry';
import { MAX_AGENT_PREVIEW_EDGE, MIN_AGENT_PREVIEW_EDGE,
  parsePreviewEncoding } from './documentPreviewArtifacts';

const MAX_PREVIEW_CACHE_ENTRIES = 64;

export type LayerPreviewResult =
  | { readonly status: 'completed'; readonly artifact: LightTableArtifactMetadata; readonly reused: boolean }
  | { readonly status: 'rejected'; readonly code: 'invalid-request' | 'document-not-ready'
      | 'layer-not-found' | 'channel-unavailable' | 'stale-document-revision' | 'renderer-unavailable';
      readonly message: string; readonly currentRevision?: number };

interface LayerPreviewSnapshot {
  readonly lifecycle: string; readonly canonicalRevision: number;
  readonly layerExists: boolean; readonly hasMask: boolean;
}

interface Dependencies {
  snapshot(documentId: DocumentSessionId, layerId: LayerId): LayerPreviewSnapshot | null;
  render(documentId: DocumentSessionId, layerId: LayerId, channel: 'pixels' | 'mask',
    maxEdge: number, encoding: LightTablePreviewEncoding): Promise<LightTableLayerPreviewRender>;
  register(file: File, context: LightTablePreviewArtifactContext): LightTableArtifactMetadata;
  query(artifactId: string): LightTableArtifactMetadata | null;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Revision-safe cache for isolated layer pixels or masks rendered by the mounted GPU owner. */
export class LayerPreviewArtifactController {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<LayerPreviewResult>>();
  private generation = 0;

  constructor(private readonly dependencies: Dependencies) {}

  request(value: unknown): Promise<LayerPreviewResult> {
    const encoding = record(value) ? parsePreviewEncoding(value) : null;
    if (!record(value) || typeof value.documentId !== 'string' || typeof value.layerId !== 'string'
      || !Number.isSafeInteger(value.expectedDocumentRevision) || (value.expectedDocumentRevision as number) < 0
      || (value.channel !== 'pixels' && value.channel !== 'mask') || !encoding
      || (value.maxEdge !== undefined && (!Number.isInteger(value.maxEdge)
        || (value.maxEdge as number) < MIN_AGENT_PREVIEW_EDGE
        || (value.maxEdge as number) > MAX_AGENT_PREVIEW_EDGE))) {
      return Promise.resolve({ status: 'rejected', code: 'invalid-request',
        message: `Layer preview requires documentId, layerId, channel, expectedDocumentRevision, maxEdge ${MIN_AGENT_PREVIEW_EDGE}-${MAX_AGENT_PREVIEW_EDGE}, and PNG or WebP encoding (WebP quality 0.1-1).` });
    }
    const documentId = value.documentId as DocumentSessionId;
    const layerId = value.layerId as LayerId;
    const channel = value.channel;
    const revision = value.expectedDocumentRevision as number;
    const maxEdge = (value.maxEdge as number | undefined) ?? MAX_AGENT_PREVIEW_EDGE;
    const opening = this.dependencies.snapshot(documentId, layerId);
    if (!opening || opening.lifecycle !== 'ready') return Promise.resolve({ status: 'rejected',
      code: 'document-not-ready', message: 'The layer preview document is not ready.' });
    if (!opening.layerExists) return Promise.resolve({ status: 'rejected', code: 'layer-not-found',
      message: 'The requested layer does not exist.' });
    if (channel === 'mask' && !opening.hasMask) return Promise.resolve({ status: 'rejected',
      code: 'channel-unavailable', message: 'The requested layer has no raster mask.' });
    if (opening.canonicalRevision !== revision) return Promise.resolve({ status: 'rejected',
      code: 'stale-document-revision', message: 'The expected document revision is stale.',
      currentRevision: opening.canonicalRevision });
    const key = `${documentId}:${revision}:${layerId}:${channel}:${maxEdge}:${encoding.format}:${encoding.quality ?? 'lossless'}`;
    const cachedId = this.cache.get(key);
    const cached = cachedId ? this.dependencies.query(cachedId) : null;
    if (cached?.kind === 'render-preview') return Promise.resolve({ status: 'completed', artifact: cached, reused: true });
    if (cachedId) this.cache.delete(key);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const generation = this.generation;
    let request!: Promise<LayerPreviewResult>;
    request = this.render(documentId, layerId, channel, revision, maxEdge, encoding, key, generation)
      .finally(() => { if (this.inFlight.get(key) === request) this.inFlight.delete(key); });
    this.inFlight.set(key, request);
    return request;
  }

  invalidateArtifact(artifactId: string): void {
    for (const [key, id] of this.cache) if (id === artifactId) this.cache.delete(key);
  }

  clear(): void { this.generation += 1; this.cache.clear(); this.inFlight.clear(); }

  private async render(documentId: DocumentSessionId, layerId: LayerId,
    channel: 'pixels' | 'mask', revision: number, maxEdge: number,
    encoding: LightTablePreviewEncoding, key: string, generation: number): Promise<LayerPreviewResult> {
    let rendered: LightTableLayerPreviewRender;
    try { rendered = await this.dependencies.render(documentId, layerId, channel, maxEdge, encoding); }
    catch (reason) { return { status: 'rejected', code: 'renderer-unavailable',
      message: reason instanceof Error ? reason.message : 'The layer preview renderer is unavailable.' }; }
    if (generation !== this.generation) return { status: 'rejected', code: 'document-not-ready',
      message: 'The layer preview owner was disposed during rendering.' };
    const closing = this.dependencies.snapshot(documentId, layerId);
    if (!closing || closing.lifecycle !== 'ready' || !closing.layerExists) return { status: 'rejected',
      code: 'document-not-ready', message: 'The layer or document closed during rendering.' };
    if (closing.canonicalRevision !== revision) return { status: 'rejected',
      code: 'stale-document-revision', message: 'The document changed while its layer preview was rendering.',
      currentRevision: closing.canonicalRevision };
    const artifact = this.dependencies.register(rendered.file, { documentId,
      canonicalRevision: revision, width: rendered.width, height: rendered.height, maxEdge,
      format: encoding.format, ...(encoding.quality === undefined ? {} : { quality: encoding.quality }),
      target: { kind: 'layer', layerId, channel, sourceToOutput: rendered.sourceToOutput } });
    this.cache.set(key, artifact.id);
    while (this.cache.size > MAX_PREVIEW_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return { status: 'completed', artifact, reused: false };
  }
}
