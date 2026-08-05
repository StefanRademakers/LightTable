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
  type TextWorkerGlyphOutlineRequest,
  type TextWorkerGlyphOutlineResult,
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
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingLayoutRequest {
  readonly request: TextWorkerRequest;
  readonly resolve: (response: TextLayoutWorkerResponse) => void;
  readonly reject: (reason: Error) => void;
  readonly detachAbort?: () => void;
  readonly timeout: ReturnType<typeof setTimeout>;
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

export interface TextGlyphOutlineReport extends TextEngineOperationReport {
  readonly outline: TextWorkerGlyphOutlineResult;
}

export type TextEngineWorkerFactory = () => TextEngineWorkerPort;

export const TEXT_ENGINE_STARTUP_TIMEOUT_MS = 10_000;
export const TEXT_ENGINE_OPERATION_TIMEOUT_MS = 10_000;

const startupTimeoutLabel = (milliseconds: number) => milliseconds >= 1_000
  ? `${Math.round(milliseconds / 1_000)} seconds`
  : `${milliseconds} milliseconds`;

const createBrowserWorker = (): TextEngineWorkerPort => new Worker(
  new URL('./textLayout.worker.ts', import.meta.url),
  { type: 'module', name: 'LightTable text layout' }
);

const variationIdentity = (value: Readonly<Record<string, number>>) => JSON.stringify(
  Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
);

export const describeTextWorkerError = (event: ErrorEvent): Error => {
  const cause = event.error instanceof Error
    ? `${event.error.name}: ${event.error.message}`
    : event.message?.trim();
  const location = event.filename
    ? `${event.filename}${event.lineno ? `:${event.lineno}${event.colno ? `:${event.colno}` : ''}` : ''}`
    : '';
  const detail = [cause, location].filter(Boolean).join(' at ');
  return new Error(detail || 'The text engine worker failed.');
};

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
  private readonly sharedLayoutRequests = new Map<string, Promise<TextLayoutWorkerResponse>>();
  private capability: TextEngineCapability | null = null;
  private inFlight: Promise<TextEngineCapability> | null = null;

  constructor(
    private readonly workerFactory: TextEngineWorkerFactory = createBrowserWorker,
    private readonly startupTimeoutMs = TEXT_ENGINE_STARTUP_TIMEOUT_MS,
    private readonly operationTimeoutMs = TEXT_ENGINE_OPERATION_TIMEOUT_MS
  ) {}

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
    const responsePromise = new Promise<TextEngineCapability>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch (reason) {
        this.pending.delete(requestId);
        reject(reason instanceof Error
          ? reason
          : new Error('The text engine probe could not be posted.'));
      }
    });
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      startupTimer = setTimeout(() => {
        const reason = new Error(
          `The text engine worker did not respond within ${startupTimeoutLabel(this.startupTimeoutMs)}.`
        );
        this.resetWorker(reason);
        reject(reason);
      }, this.startupTimeoutMs);
    });
    let trackedPromise: Promise<TextEngineCapability>;
    trackedPromise = Promise.race([responsePromise, timeoutPromise]).then((capability) => {
      this.capability = capability;
      return capability;
    }).finally(() => {
      if (startupTimer !== undefined) clearTimeout(startupTimer);
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
      const timeout = setTimeout(() => {
        if (!this.pendingInspections.has(requestId)) return;
        const reason = this.operationTimeoutError('font inspection');
        this.resetWorker(reason);
      }, this.operationTimeoutMs);
      this.pendingInspections.set(requestId, { resolve, reject, timeout });
      try {
        worker.postMessage({
          kind: 'inspect-font',
          protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
          requestId,
          bytes: transferred,
          faceIndex
        }, [transferred]);
      } catch (reason) {
        this.pendingInspections.delete(requestId);
        clearTimeout(timeout);
        reject(reason instanceof Error ? reason : new Error('Font inspection could not be posted.'));
      }
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
    const request = {
      ...input,
      kind: 'rasterize-glyph',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId
    } satisfies TextWorkerGlyphRasterRequest;
    const sharedKey = [
      'raster', request.documentSessionId, request.sessionGeneration,
      request.assetId, request.faceIndex, request.glyphId, request.ppem,
      request.fontSnapshotRevision, variationIdentity(request.variationCoordinates),
      request.syntheticBold ? 1 : 0, request.syntheticItalic ? 1 : 0,
      request.hinting, request.renderMode
    ].join(':');
    return this.requestSharedLayout(sharedKey, request, signal).then((response) => {
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

  extractGlyphOutline(
    input: Omit<TextWorkerGlyphOutlineRequest, 'requestId' | 'protocolVersion'>,
    signal?: AbortSignal
  ): Promise<TextGlyphOutlineReport> {
    const startedAt = performance.now();
    const request = {
      ...input,
      kind: 'extract-glyph-outline',
      protocolVersion: TEXT_WORKER_PROTOCOL_VERSION,
      requestId: ++this.requestId
    } satisfies TextWorkerGlyphOutlineRequest;
    const sharedKey = [
      'outline', request.documentSessionId, request.sessionGeneration,
      request.assetId, request.faceIndex, request.glyphId,
      request.fontSnapshotRevision, variationIdentity(request.variationCoordinates)
    ].join(':');
    return this.requestSharedLayout(sharedKey, request, signal).then((response) => {
      if (response.kind === 'glyph-outline-extraction-failed') {
        throw new TextLayoutRuntimeError(response.error);
      }
      if (response.kind !== 'glyph-outline-extracted') {
        throw new Error(`Unexpected ${response.kind} response to glyph outline extraction.`);
      }
      return {
        outline: response.outline,
        metrics: response.metrics,
        roundTripDurationMs: performance.now() - startedAt,
        responseTransferBytes: collectTextResponseTransferBuffers(response)
          .reduce((total, buffer) => total + buffer.byteLength, 0)
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
      if (data.kind === 'error') {
        const reason = new Error(data.message);
        const pendingLayout = this.pendingLayouts.get(data.requestId);
        if (pendingLayout) {
          this.pendingLayouts.delete(data.requestId);
          pendingLayout.detachAbort?.();
          clearTimeout(pendingLayout.timeout);
          pendingLayout.reject(reason);
          this.resetWorker(reason);
          return;
        }
      }
      if (data.kind === 'font-registered' || data.kind === 'font-registration-failed'
        || data.kind === 'text-realized' || data.kind === 'text-layout-failed'
        || data.kind === 'glyph-rasterized' || data.kind === 'glyph-rasterization-failed'
        || data.kind === 'glyph-outline-extracted' || data.kind === 'glyph-outline-extraction-failed'
        || data.kind === 'session-released' || data.kind === 'session-release-failed') {
        const pending = this.pendingLayouts.get(data.requestId);
        if (!pending) return;
        this.pendingLayouts.delete(data.requestId);
        pending.detachAbort?.();
        clearTimeout(pending.timeout);
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
          if (pending.request.kind === 'extract-glyph-outline'
            && data.kind === 'glyph-outline-extracted'
            && (data.assetId !== pending.request.assetId
              || data.faceIndex !== pending.request.faceIndex
              || data.glyphId !== pending.request.glyphId
              || data.fontSnapshotRevision !== pending.request.fontSnapshotRevision
              || variationIdentity(data.variationCoordinates)
                !== variationIdentity(pending.request.variationCoordinates))) {
            throw new Error('Glyph outline response identity is stale.');
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
      if ('timeout' in pending) clearTimeout(pending.timeout);
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
      this.resetWorker(describeTextWorkerError(event));
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
    for (const pending of this.pendingInspections.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pendingInspections.clear();
    for (const pending of this.pendingLayouts.values()) {
      pending.detachAbort?.();
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
    this.pendingLayouts.clear();
    this.sharedLayoutRequests.clear();
  }

  private requestSharedLayout(
    key: string,
    request: TextWorkerRequest,
    signal?: AbortSignal
  ): Promise<TextLayoutWorkerResponse> {
    if (signal?.aborted) return Promise.reject(this.cancelledLayoutError());
    let physical = this.sharedLayoutRequests.get(key);
    if (!physical) {
      physical = this.requestLayout(request);
      this.sharedLayoutRequests.set(key, physical);
      void physical.finally(() => {
        if (this.sharedLayoutRequests.get(key) === physical) {
          this.sharedLayoutRequests.delete(key);
        }
      }).catch(() => undefined);
    }
    if (!signal) return physical;
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        reject(this.cancelledLayoutError());
      };
      signal.addEventListener('abort', abort, { once: true });
      void physical!.then(
        (response) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          resolve(response);
        },
        (reason: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          reject(reason);
        }
      );
    });
  }

  private cancelledLayoutError() {
    return new TextLayoutRuntimeError(
      createTextLayoutError('cancelled', 'Text layout was cancelled.')
    );
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
        clearTimeout(pending.timeout);
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
      const timeout = setTimeout(() => {
        if (!this.pendingLayouts.has(request.requestId)) return;
        const reason = this.operationTimeoutError(`'${request.kind}'`);
        this.resetWorker(reason);
      }, this.operationTimeoutMs);
      this.pendingLayouts.set(request.requestId, { request, resolve, reject, detachAbort, timeout });
      try {
        worker.postMessage(request, [...collectTextRequestTransferBuffers(request)]);
      } catch (reason) {
        this.pendingLayouts.delete(request.requestId);
        detachAbort?.();
        clearTimeout(timeout);
        reject(reason instanceof Error ? reason : new Error('Text worker request could not be posted.'));
      }
    });
  }

  private operationTimeoutError(operation: string) {
    return new Error(
      `The text engine ${operation} request did not respond within ${startupTimeoutLabel(this.operationTimeoutMs)}.`
    );
  }
}

export const lightTableTextEngine = new TextEngineClient();
