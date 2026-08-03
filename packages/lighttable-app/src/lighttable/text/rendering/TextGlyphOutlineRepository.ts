import type { FontAssetRef, TextWorkerGlyphOutlineResult } from '@lighttable/text-core';
import {
  GLYPH_OUTLINE_EXTRACTOR_VERSION,
  GlyphOutlineCache,
  serializeGlyphOutlineKey,
  type GlyphOutlineKey
} from '@lighttable/text-rendering';
import type { TextEngineClient } from '../wasm/TextEngineClient';

export interface TextGlyphOutlineRequest {
  readonly documentSessionId: string;
  readonly sessionGeneration: number;
  readonly fontSnapshotRevision: number;
  readonly font: FontAssetRef;
  readonly glyphId: number;
  readonly variationCoordinates: Readonly<Record<string, number>>;
}

export interface TextGlyphOutlineResolution {
  readonly outline: TextWorkerGlyphOutlineResult;
  readonly source: 'cache' | 'worker' | 'shared-worker';
}

const aborted = () => new DOMException('Glyph outline request was cancelled.', 'AbortError');

const waitFor = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw aborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

/** Shares immutable outline work across layers without coupling it to viewport state. */
export class TextGlyphOutlineRepository {
  private readonly pending = new Map<string, Promise<TextWorkerGlyphOutlineResult>>();

  constructor(
    private readonly client: Pick<TextEngineClient, 'extractGlyphOutline'>,
    readonly cache = new GlyphOutlineCache()
  ) {}

  async resolve(
    request: TextGlyphOutlineRequest,
    signal?: AbortSignal
  ): Promise<TextGlyphOutlineResolution> {
    const key: GlyphOutlineKey = {
      fontFingerprintSha256: request.font.fingerprintSha256,
      faceIndex: request.font.faceIndex,
      glyphId: request.glyphId,
      variationCoordinates: request.variationCoordinates,
      extractorVersion: GLYPH_OUTLINE_EXTRACTOR_VERSION
    };
    const cached = this.cache.get(key);
    if (cached) return { outline: cached, source: 'cache' };
    const serialized = serializeGlyphOutlineKey(key);
    const existing = this.pending.get(serialized);
    if (existing) {
      return { outline: await waitFor(existing, signal), source: 'shared-worker' };
    }
    const pending = this.client.extractGlyphOutline({
      kind: 'extract-glyph-outline',
      documentSessionId: request.documentSessionId,
      sessionGeneration: request.sessionGeneration,
      assetId: request.font.assetId,
      faceIndex: request.font.faceIndex,
      glyphId: request.glyphId,
      fontSnapshotRevision: request.fontSnapshotRevision,
      variationCoordinates: request.variationCoordinates
    }).then(({ outline }) => this.cache.set(key, outline));
    this.pending.set(serialized, pending);
    void pending.finally(() => {
      if (this.pending.get(serialized) === pending) this.pending.delete(serialized);
    }).catch(() => undefined);
    return { outline: await waitFor(pending, signal), source: 'worker' };
  }

  clear() {
    this.cache.clear();
  }
}
