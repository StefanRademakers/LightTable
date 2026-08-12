import type {
  PreparedSmartSelectionSource,
  SmartSelectionBackend,
  SmartSelectionCandidate,
  SmartSelectionPrompt,
  SmartSelectionRequestOptions,
  SmartSelectionSource
} from './SmartSelectionBackend';
import type { SlimSamWorkerRequest, SlimSamWorkerResponse } from './slimSamProtocol';

interface PendingRequest {
  readonly resolve: (message: SlimSamWorkerResponse) => void;
  readonly reject: (reason: Error) => void;
}

export class SlimSamSmartSelectionBackend implements SmartSelectionBackend {
  readonly identity = {
    modelId: 'Xenova/slimsam-77-uniform', artifactRevision: 'main',
    precision: 'auto', preprocessingRevision: 'sam-v1'
  } as const;
  readonly capabilities = {
    positivePoints: true, negativePoints: true, boxes: true,
    previousMask: false, automaticSubject: true
  } as const;
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly preparedByKey = new Map<string, Promise<PreparedSmartSelectionSource>>();

  async prepare(source: SmartSelectionSource, signal?: AbortSignal) {
    const existing = this.preparedByKey.get(source.key);
    if (existing) return existing;
    const promise = this.request({
      type: 'prepare', requestId: 0, sourceId: source.key,
      revision: source.documentRevision, image: source.image
    }, signal).then((message) => {
      if (message.type !== 'prepared') throw new Error('Smart selection returned no prepared source.');
      return {
        id: message.sourceId,
        sourceKey: source.key,
        documentRevision: message.revision,
        width: message.width,
        height: message.height
      };
    }).catch((reason) => {
      this.preparedByKey.delete(source.key);
      throw reason;
    });
    this.preparedByKey.set(source.key, promise);
    while (this.preparedByKey.size > 1) {
      const oldest = this.preparedByKey.keys().next().value as string;
      if (oldest === source.key) break;
      this.disposeSourceId(oldest);
    }
    return promise;
  }

  selectPrompt(
    source: PreparedSmartSelectionSource,
    prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions
  ) {
    if (prompt.previousMask) throw new Error('SlimSAM does not accept a previous mask prompt.');
    if (prompt.box && prompt.points.length === 0) {
      const bounds = prompt.box;
      return this.select(source, {
        type: 'box', requestId: 0, sourceId: source.id,
        box: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
        hardEdge: options.hardEdge
      }, options.signal);
    }
    if (prompt.points.length === 0) throw new Error('Object Selection requires a point or box prompt.');
    return this.select(source, {
      type: 'points', requestId: 0, sourceId: source.id,
      points: prompt.points.map(({ point }) => [point.x, point.y]),
      labels: prompt.points.map(({ label }) => label === 'positive' ? 1 : 0),
      box: prompt.box
        ? [prompt.box.x, prompt.box.y, prompt.box.x + prompt.box.width, prompt.box.y + prompt.box.height]
        : undefined,
      hardEdge: options.hardEdge
    }, options.signal);
  }

  selectSubject(source: PreparedSmartSelectionSource, options: SmartSelectionRequestOptions) {
    return this.select(source, {
      type: 'subject', requestId: 0, sourceId: source.id, hardEdge: options.hardEdge
    }, options.signal);
  }

  disposePreparedSource(source: PreparedSmartSelectionSource) {
    this.disposeSourceId(source.id);
  }

  dispose() {
    this.worker?.postMessage({ type: 'dispose' } satisfies SlimSamWorkerRequest);
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Smart selection was canceled.'));
    this.pending.clear();
    this.preparedByKey.clear();
  }

  private async select(
    source: PreparedSmartSelectionSource,
    request: Extract<SlimSamWorkerRequest, { type: 'points' | 'box' | 'subject' }>,
    signal?: AbortSignal
  ): Promise<SmartSelectionCandidate[]> {
    const message = await this.request(request, signal);
    if (message.type === 'superseded') return [];
    if (message.type !== 'candidates' || message.sourceId !== source.id) {
      throw new Error('Smart selection returned candidates for a different source.');
    }
    return message.masks.map((data, index) => ({
      id: `${source.id}:${index}`,
      score: message.scores[index] ?? 0,
      mask: { width: message.width, height: message.height, data: new Uint8Array(data) }
    }));
  }

  private disposeSourceId(sourceId: string) {
    this.preparedByKey.delete(sourceId);
    this.worker?.postMessage({ type: 'dispose-source', sourceId } satisfies SlimSamWorkerRequest);
  }

  private request(request: SlimSamWorkerRequest, signal?: AbortSignal): Promise<SlimSamWorkerResponse> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const worker = this.ensureWorker();
    const requestId = ++this.requestId;
    const message = { ...request, requestId } as SlimSamWorkerRequest;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve: (result) => {
          signal?.removeEventListener('abort', abort);
          resolve(result);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', abort);
          reject(reason);
        }
      });
      worker.postMessage(message);
    });
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./slimSam.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SlimSamWorkerResponse>) => {
      if (event.data.type === 'status') return;
      if (event.data.type === 'metric') {
        const trace = (globalThis as typeof globalThis & {
          __LIGHTTABLE_SMART_SELECTION_TRACE__?: Array<{
            event: string;
            detail?: Record<string, unknown>;
          }>;
        }).__LIGHTTABLE_SMART_SELECTION_TRACE__;
        trace?.push({ event: 'backend-metric', detail: {
          phase: event.data.phase,
          durationMs: event.data.durationMs,
          backend: event.data.backend
        } });
        return;
      }
      const pending = this.pending.get(event.data.requestId);
      if (!pending) return;
      this.pending.delete(event.data.requestId);
      if (event.data.type === 'error') pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Smart selection worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
