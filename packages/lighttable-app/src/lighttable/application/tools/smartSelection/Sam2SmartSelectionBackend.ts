import type {
  PreparedSmartSelectionSource, SmartSelectionBackend, SmartSelectionCandidate,
  SmartSelectionBackendStatus, SmartSelectionPrompt, SmartSelectionRequestOptions, SmartSelectionSource
} from './SmartSelectionBackend';
import type { Sam2WorkerRequest, Sam2WorkerResponse } from './sam2Protocol';
import { SAM2_SMALL_PROFILE } from './smartSelectionModels';

interface PendingRequest {
  readonly resolve: (message: Sam2WorkerResponse) => void;
  readonly reject: (reason: Error) => void;
}

export class Sam2SmartSelectionBackend implements SmartSelectionBackend {
  readonly identity = SAM2_SMALL_PROFILE;
  readonly capabilities = {
    positivePoints: true, negativePoints: true, boxes: true,
    previousMask: false, automaticSubject: true
  } as const;
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly preparedByKey = new Map<string, Promise<PreparedSmartSelectionSource>>();
  private readonly statusListeners = new Set<(status: SmartSelectionBackendStatus) => void>();
  private disposed = false;

  async prepare(source: SmartSelectionSource, signal?: AbortSignal) {
    const cacheKey = [source.key, this.identity.modelId, this.identity.artifactRevision,
      this.identity.precision, this.identity.preprocessingRevision].join(':');
    const existing = this.preparedByKey.get(cacheKey);
    if (existing) return existing;
    const promise = this.request({ type: 'prepare', requestId: 0, sourceId: cacheKey,
      revision: source.documentRevision, image: source.image, profile: 'sam2-small' }, signal).then((message) => {
      if (message.type !== 'prepared') throw new Error('SAM 2 returned no prepared source.');
      return { id: message.sourceId, sourceKey: source.key, documentRevision: message.revision,
        width: message.width, height: message.height };
    }).catch((reason) => { this.preparedByKey.delete(cacheKey); throw reason; });
    this.preparedByKey.set(cacheKey, promise);
    while (this.preparedByKey.size > 1) {
      const oldest = this.preparedByKey.keys().next().value as string;
      if (oldest === cacheKey) break;
      this.disposeSourceId(oldest);
    }
    return promise;
  }

  async selectPrompt(source: PreparedSmartSelectionSource, prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions): Promise<SmartSelectionCandidate[]> {
    if (prompt.previousMask) throw new Error('The current SAM 2 graph does not accept a previous mask.');
    if (!prompt.box && prompt.points.length === 0) throw new Error('Object Selection requires a point or box prompt.');
    const bounds = prompt.box;
    const box = bounds
      ? [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height] as const
      : undefined;
    const message = await this.request(prompt.points.length === 0 && box
      ? { type: 'box', requestId: 0, sourceId: source.id, box,
          refineEdges: options.refineEdges, refinementQuality: options.refinementQuality }
      : {
          type: 'points', requestId: 0, sourceId: source.id,
          points: prompt.points.map(({ point }) => [point.x, point.y]),
          labels: prompt.points.map(({ label }) => label === 'positive' ? 1 : 0),
          box,
          refineEdges: options.refineEdges, refinementQuality: options.refinementQuality
        }, options.signal);
    if (message.type === 'superseded') return [];
    if (message.type !== 'candidates' || message.sourceId !== source.id) throw new Error('SAM 2 returned candidates for a different source.');
    return message.masks.map((data, index) => ({ id: `${source.id}:${index}`,
      score: message.scores[index] ?? 0,
      mask: { width: message.width, height: message.height, data: new Uint8Array(data) } }));
  }

  async selectSubject(source: PreparedSmartSelectionSource,
    options: SmartSelectionRequestOptions): Promise<SmartSelectionCandidate[]> {
    const message = await this.request({
      type: 'subject', requestId: 0, sourceId: source.id,
      refineEdges: options.refineEdges, refinementQuality: options.refinementQuality
    }, options.signal);
    if (message.type === 'superseded') return [];
    if (message.type !== 'candidates' || message.sourceId !== source.id) {
      throw new Error('SAM 2 returned subject candidates for a different source.');
    }
    return message.masks.map((data, index) => ({
      id: `${source.id}:subject:${index}`,
      score: message.scores[index] ?? 0,
      mask: { width: message.width, height: message.height, data: new Uint8Array(data) }
    }));
  }

  subscribeStatus(listener: (status: SmartSelectionBackendStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disposePreparedSource(source: PreparedSmartSelectionSource) { this.disposeSourceId(source.id); }
  dispose() {
    this.disposed = true;
    try { this.worker?.postMessage({ type: 'dispose' } satisfies Sam2WorkerRequest); } catch { /* terminate below */ }
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Smart selection was canceled.'));
    this.pending.clear();
    this.preparedByKey.clear();
    this.statusListeners.clear();
  }
  private disposeSourceId(sourceId: string) {
    this.preparedByKey.delete(sourceId);
    try { this.worker?.postMessage({ type: 'dispose-source', sourceId } satisfies Sam2WorkerRequest); } catch { /* worker may already be gone */ }
  }
  private request(request: Sam2WorkerRequest, signal?: AbortSignal): Promise<Sam2WorkerResponse> {
    if (this.disposed) return Promise.reject(new Error('Smart selection is closed.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const worker = this.ensureWorker();
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(requestId); reject(new DOMException('Aborted', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, { resolve: (result) => { signal?.removeEventListener('abort', abort); resolve(result); },
        reject: (reason) => { signal?.removeEventListener('abort', abort); reject(reason); } });
      try {
        worker.postMessage({ ...request, requestId });
      } catch (reason) {
        this.pending.delete(requestId);
        signal?.removeEventListener('abort', abort);
        reject(reason instanceof Error ? reason : new Error('Smart selection failed to start.'));
      }
    });
  }
  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./slimSam.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Sam2WorkerResponse>) => {
      if (event.data.type === 'status') {
        if (!event.data.message) return;
        for (const listener of this.statusListeners) listener({
          message: event.data.message,
          ...(event.data.progress === undefined ? {} : { progress: event.data.progress })
        });
        return;
      }
      if (event.data.type === 'metric') {
        const trace = (globalThis as typeof globalThis & { __LIGHTTABLE_SMART_SELECTION_TRACE__?: Array<{ event: string; detail?: Record<string, unknown> }> }).__LIGHTTABLE_SMART_SELECTION_TRACE__;
        trace?.push({ event: 'backend-metric', detail: { modelId: this.identity.modelId,
          phase: event.data.phase, durationMs: event.data.durationMs, backend: event.data.backend } });
        return;
      }
      const pending = this.pending.get(event.data.requestId);
      if (!pending) return;
      this.pending.delete(event.data.requestId);
      if (event.data.type === 'error') pending.reject(new Error(event.data.message)); else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'SAM 2 worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear(); worker.terminate(); if (this.worker === worker) this.worker = null;
    };
    worker.onmessageerror = () => {
      const error = new Error('SAM 2 worker returned an unreadable response.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear(); worker.terminate(); if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
