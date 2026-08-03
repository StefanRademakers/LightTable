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

interface PendingOutline {
  readonly promise: Promise<TextWorkerGlyphOutlineResult>;
  readonly controller: AbortController;
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
  private readonly pending = new Map<string, PendingOutline>();

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
      return { outline: await waitFor(existing.promise, signal), source: 'shared-worker' };
    }
    const controller = new AbortController();
    const promise = this.client.extractGlyphOutline({
      kind: 'extract-glyph-outline',
      documentSessionId: request.documentSessionId,
      sessionGeneration: request.sessionGeneration,
      assetId: request.font.assetId,
      faceIndex: request.font.faceIndex,
      glyphId: request.glyphId,
      fontSnapshotRevision: request.fontSnapshotRevision,
      variationCoordinates: request.variationCoordinates
    }, controller.signal).then(({ outline }) => {
      if (controller.signal.aborted) throw aborted();
      return this.cache.set(key, outline);
    });
    const pending = { promise, controller };
    this.pending.set(serialized, pending);
    void promise.finally(() => {
      if (this.pending.get(serialized) === pending) this.pending.delete(serialized);
    }).catch(() => undefined);
    return { outline: await waitFor(promise, signal), source: 'worker' };
  }

  clear() {
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    this.cache.clear();
  }
}
