import {
  TEXT_ENGINE_PROTOCOL_VERSION,
  type TextEngineCapability,
  type TextEngineFontInspection,
  type TextEngineWorkerRequest,
  type TextEngineWorkerResponse
} from './textEngineProtocol';
import {
  TEXT_WORKER_PROTOCOL_VERSION,
  assertTextLayoutWorkerResponse,
  collectTextRequestTransferBuffers,
  collectTextResponseTransferBuffers,
  createTextLayoutError,
  type RealizedTextLayout,
  type TextLayoutError,
  type TextLayoutWorkerRequest,
  type TextLayoutWorkerResponse,
  type TextWorkerFontRegistrationRequest,
  type TextWorkerGlyphRasterRequest,
  type TextWorkerGlyphRasterResult,
  type TextWorkerPerformanceMetrics,
  type TextWorkerReleaseSessionRequest,
  type TextWorkerRequest
} from '@lighttable/text-core';

interface PendingProbe {
  readonly resolve: (capability: TextEngineCapability) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingInspection {
  readonly resolve: (inspection: TextEngineFontInspection) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingLayoutRequest {
  readonly request: TextWorkerRequest;
  readonly resolve: (response: TextLayoutWorkerResponse) => void;
  readonly reject: (reason: Error) => void;
  readonly detachAbort?: () => void;
}

export class TextLayoutRuntimeError extends Error {
  constructor(readonly layoutError: TextLayoutError) {
    super(layoutError.message);
    this.name = 'TextLayoutRuntimeError';
  }
}

export interface TextEngineWorkerPort {
  onmessage: ((event: MessageEvent<TextEngineWorkerResponse | TextLayoutWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: TextEngineWorkerRequest | TextWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface TextEngineOperationReport {
  readonly metrics: TextWorkerPerformanceMetrics;
  readonly roundTripDurationMs: number;
  readonly responseTransferBytes: number;
}

export interface TextRealizationReport extends TextEngineOperationReport {
  readonly layout: RealizedTextLayout;
}

export interface TextGlyphRasterReport extends TextEngineOperationReport {
  readonly raster: TextWorkerGlyphRasterResult;
}

export type TextEngineWorkerFactory = () => TextEngineWorkerPort;

const createBrowserWorker = (): TextEngineWorkerPort => new Worker(
  new URL('./textLayout.worker.ts', import.meta.url),
  { type: 'module', name: 'LightTable text layout' }
);

const variationIdentity = (value: Readonly<Record<string, number>>) => JSON.stringify(
  Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
);

/**
 * Lazy application-scoped bridge to the Rust/WASM text engine.
 *
 * Construction and module import perform no worker or WASM work. The first
 * explicit probe creates one persistent worker; successful results are reused.
 */
export class TextEngineClient {
  private worker: TextEngineWorkerPort | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingProbe>();
  private readonly pendingInspections = new Map<number, PendingInspection>();
  private readonly pendingLayouts = new Map<number, PendingLayoutRequest>();
  private capability: TextEngineCapability | null = null;
  private inFlight: Promise<TextEngineCapability> | null = null;

  constructor(private readonly workerFactory: TextEngineWorkerFactory = createBrowserWorker) {}

  probe(): Promise<TextEngineCapability> {
    if (this.capability) return Promise.resolve(this.capability);
    if (this.inFlight) return this.inFlight;

    let worker: TextEngineWorkerPort;
    try {
      worker = this.ensureWorker();
    } catch (reason) {
      return Promise.reject(reason instanceof Error
        ? reason
        : new Error('The text engine worker could not start.'));
    }
    const requestId = ++this.requestId;
    const request: TextEngineWorkerRequest = {
      kind: 'probe',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId
    };
    let trackedPromise: Promise<TextEngineCapability>;
    trackedPromise = new Promise<TextEngineCapability>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage(request);
    }).then((capability) => {
      this.capability = capability;
      return capability;
    }).finally(() => {
      if (this.inFlight === trackedPromise) this.inFlight = null;
    });
    this.inFlight = trackedPromise;
    return trackedPromise;
  }

  inspectFont(bytes: Uint8Array, faceIndex: number): Promise<TextEngineFontInspection> {
    let worker: TextEngineWorkerPort;
    try {
      worker = this.ensureWorker();
    } catch (reason) {
      return Promise.reject(reason instanceof Error ? reason : new Error('The text engine worker could not start.'));
    }
    const requestId = ++this.requestId;
    const transferred = Uint8Array.from(bytes).buffer;
    return new Promise((resolve, reject) => {
      this.pendingInspections.set(requestId, { resolve, reject });
      worker.postMessage({
        kind: 'inspect-font',
        protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
        requestId,
        bytes: transferred,
        faceIndex
      }, [transferred]);
    });
  }

  registerFont(
    input: Omit<TextWorkerFontRegistrationRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<void> {
    return this.registerFontDetailed(input, signal).then(() => undefined);
  }

  registerFontDetailed(
    input: Omit<TextWorkerFontRegistrationRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<TextEngineOperationReport> {
    const startedAt = performance.now();
    return this.requestLayout({
      ...input,
      kind: 'register-font',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId
    }, signal).then((response) => {
      if (response.kind === 'font-registration-failed') {
        throw new TextLayoutRuntimeError(response.error);
      }
      if (response.kind !== 'font-registered') {
        throw new Error(`Unexpected ${response.kind} response to font registration.`);
      }
      return {
        metrics: response.metrics,
        roundTripDurationMs: performance.now() - startedAt,
        responseTransferBytes: 0
      };
    });
  }

  realizeText(
    input: Omit<TextLayoutWorkerRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<RealizedTextLayout> {
    return this.realizeTextDetailed(input, signal).then((result) => result.layout);
  }

  realizeTextDetailed(
    input: Omit<TextLayoutWorkerRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<TextRealizationReport> {
    const startedAt = performance.now();
    return this.requestLayout({
      ...input,
      kind: 'realize-text',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId
    }, signal).then((response) => {
      if (response.kind === 'text-layout-failed') {
        throw new TextLayoutRuntimeError(response.error);
      }
      if (response.kind !== 'text-realized') {
        throw new Error(`Unexpected ${response.kind} response to text realization.`);
      }
      return {
        layout: response.layout,
        metrics: response.metrics,
        roundTripDurationMs: performance.now() - startedAt,
        responseTransferBytes: collectTextResponseTransferBuffers(response)
          .reduce((total, buffer) => total + buffer.byteLength, 0)
      };
    });
  }

  rasterizeGlyph(
    input: Omit<TextWorkerGlyphRasterRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<TextGlyphRasterReport> {
    const startedAt = performance.now();
    return this.requestLayout({
      ...input,
      kind: 'rasterize-glyph',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId
    }, signal).then((response) => {
      if (response.kind === 'glyph-rasterization-failed') {
        throw new TextLayoutRuntimeError(response.error);
      }
      if (response.kind !== 'glyph-rasterized') {
        throw new Error(`Unexpected ${response.kind} response to glyph rasterization.`);
      }
      return {
        raster: response.raster,
        metrics: response.metrics,
        roundTripDurationMs: performance.now() - startedAt,
        responseTransferBytes: response.raster.pixels.byteLength
      };
    });
  }

  releaseSession(documentSessionId: string, sessionGeneration: number): Promise<void> {
    const request: TextWorkerReleaseSessionRequest = {
      kind: 'release-session',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId,
      documentSessionId,
      sessionGeneration
    };
    return this.requestLayout(request).then((response) => {
      if (response.kind === 'session-release-failed') {
        throw new TextLayoutRuntimeError(response.error);
      }
      if (response.kind !== 'session-released') {
        throw new Error(`Unexpected ${response.kind} response to session release.`);
      }
    });
  }

  dispose() {
    this.resetWorker(new Error('Text engine probing was canceled.'));
    this.capability = null;
    this.inFlight = null;
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.onmessage = ({ data }) => {
      if (data.kind === 'font-registered' || data.kind === 'font-registration-failed'
        || data.kind === 'text-realized' || data.kind === 'text-layout-failed'
        || data.kind === 'glyph-rasterized' || data.kind === 'glyph-rasterization-failed'
        || data.kind === 'session-released' || data.kind === 'session-release-failed') {
        const pending = this.pendingLayouts.get(data.requestId);
        if (!pending) return;
        this.pendingLayouts.delete(data.requestId);
        pending.detachAbort?.();
        try {
          assertTextLayoutWorkerResponse(data);
          if (
            data.documentSessionId !== pending.request.documentSessionId
            || data.sessionGeneration !== pending.request.sessionGeneration
          ) throw new Error('Text layout response identity is stale.');
          if ('cacheKey' in pending.request && pending.request.kind === 'realize-text'
            && data.cacheKey !== pending.request.cacheKey) {
            throw new Error('Text layout response cache identity is stale.');
          }
          if (pending.request.kind === 'rasterize-glyph' && data.kind === 'glyph-rasterized'
            && (data.assetId !== pending.request.assetId
              || data.faceIndex !== pending.request.faceIndex
              || data.glyphId !== pending.request.glyphId
              || data.ppem !== pending.request.ppem
              || data.fontSnapshotRevision !== pending.request.fontSnapshotRevision
              || variationIdentity(data.variationCoordinates) !== variationIdentity(pending.request.variationCoordinates)
              || data.syntheticBold !== pending.request.syntheticBold
              || data.syntheticItalic !== pending.request.syntheticItalic
              || data.hinting !== pending.request.hinting
              || data.renderMode !== pending.request.renderMode)) {
            throw new Error('Glyph raster response identity is stale.');
          }
          pending.resolve(data);
        } catch (reason) {
          pending.reject(reason instanceof Error ? reason : new Error('Invalid text layout response.'));
        }
        return;
      }
      const pending = this.pending.get(data.requestId)
        ?? this.pendingInspections.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      this.pendingInspections.delete(data.requestId);
      if (Number(data.protocolVersion) !== TEXT_ENGINE_PROTOCOL_VERSION) {
        pending.reject(new Error(`Unsupported text engine protocol ${Number(data.protocolVersion)}.`));
        this.resetWorker(new Error('The text engine protocol changed during initialization.'));
        return;
      }
      if (data.kind === 'error') {
        pending.reject(new Error(data.message));
        this.resetWorker(new Error(data.message));
        return;
      }
      if (data.kind === 'font-inspected') {
        (pending as PendingInspection).resolve({
          glyphCount: data.glyphCount,
          unitsPerEm: data.unitsPerEm,
          axisCount: data.axisCount,
          outline: data.outline,
          embeddingLevel: data.embeddingLevel,
          noSubsetting: data.noSubsetting,
          bitmapOnly: data.bitmapOnly
        });
      } else {
        (pending as PendingProbe).resolve({
          engineVersion: data.engineVersion,
          loadDurationMs: data.loadDurationMs
        });
      }
    };
    worker.onerror = (event) => {
      this.resetWorker(new Error(event.message || 'The text engine worker failed.'));
    };
    worker.onmessageerror = () => {
      this.resetWorker(new Error('The text engine worker returned an unreadable response.'));
    };
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error) {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
    for (const pending of this.pendingInspections.values()) pending.reject(reason);
    this.pendingInspections.clear();
    for (const pending of this.pendingLayouts.values()) {
      pending.detachAbort?.();
      pending.reject(reason);
    }
    this.pendingLayouts.clear();
  }

  private requestLayout(
    request: TextWorkerRequest,
    signal?: AbortSignal
  ): Promise<TextLayoutWorkerResponse> {
    if (signal?.aborted) {
      return Promise.reject(new TextLayoutRuntimeError(
        createTextLayoutError('cancelled', 'Text layout was cancelled.')
      ));
    }
    let worker: TextEngineWorkerPort;
    try {
      worker = this.ensureWorker();
    } catch (reason) {
      return Promise.reject(reason instanceof Error ? reason : new Error('The text engine worker could not start.'));
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pendingLayouts.get(request.requestId);
        if (!pending) return;
        this.pendingLayouts.delete(request.requestId);
        const cancelRequest: TextWorkerRequest = {
          kind: 'cancel-text',
          protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
          requestId: ++this.requestId,
          documentSessionId: request.documentSessionId,
          sessionGeneration: request.sessionGeneration,
          targetRequestId: request.requestId
        };
        try {
          worker.postMessage(cancelRequest);
        } catch {
          // The local rejection is authoritative; a failed best-effort cancel
          // must not strand the caller or restore the removed pending entry.
        }
        reject(new TextLayoutRuntimeError(
          createTextLayoutError('cancelled', 'Text layout was cancelled.')
        ));
      };
      const detachAbort = signal
        ? () => signal.removeEventListener('abort', abort)
        : undefined;
      signal?.addEventListener('abort', abort, { once: true });
      this.pendingLayouts.set(request.requestId, { request, resolve, reject, detachAbort });
      try {
        worker.postMessage(request, [...collectTextRequestTransferBuffers(request)]);
      } catch (reason) {
        this.pendingLayouts.delete(request.requestId);
        detachAbort?.();
        reject(reason instanceof Error ? reason : new Error('Text worker request could not be posted.'));
      }
    });
  }
}

export const lightTableTextEngine = new TextEngineClient();
