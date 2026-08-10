export interface InferenceProgress {
  readonly status: string;
  readonly message?: string;
  readonly progress?: number;
}

interface PendingRequest<Result> {
  readonly resolve: (result: Result) => void;
  readonly reject: (reason: Error) => void;
  readonly publishProgress: (progress: InferenceProgress) => void;
}

interface InFlightRequest<Result> {
  readonly promise: Promise<Result>;
  readonly listeners: Set<(progress: InferenceProgress) => void>;
}

export interface WorkerInferenceClientOptions<Input, Result> {
  readonly createWorker: () => Worker;
  readonly createRequest: (requestId: number, input: Input) => unknown;
  readonly parseResult: (message: Record<string, unknown>) => Result;
  readonly cacheSize?: number;
  readonly disposeMessage?: unknown;
  readonly defaultErrorMessage: string;
}

/**
 * Shared lifecycle for lazy, worker-backed inference features.
 *
 * Model loading and tensor interpretation intentionally remain inside the
 * feature worker. This class only owns the repeatable product concerns:
 * request correlation, shared in-flight work, a bounded prepared-result
 * cache, progress fan-out and deterministic teardown after worker failure.
 */
export class WorkerInferenceClient<Input, Result> {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest<Result>>();
  private readonly cache = new Map<string, Result>();
  private readonly inFlight = new Map<string, InFlightRequest<Result>>();

  constructor(private readonly options: WorkerInferenceClientOptions<Input, Result>) {}

  async run(
    input: Input,
    cacheKey: string,
    onProgress?: (progress: InferenceProgress) => void
  ): Promise<Result> {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const running = this.inFlight.get(cacheKey);
    if (running) {
      if (onProgress) running.listeners.add(onProgress);
      return running.promise;
    }

    const worker = this.ensureWorker();
    const requestId = ++this.requestId;
    const listeners = new Set<(progress: InferenceProgress) => void>();
    if (onProgress) listeners.add(onProgress);
    const promise = new Promise<Result>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        publishProgress: (progress) => listeners.forEach((listener) => listener(progress))
      });
      worker.postMessage(this.options.createRequest(requestId, input));
    }).then((result) => {
      this.cache.set(cacheKey, result);
      const limit = Math.max(0, this.options.cacheSize ?? 2);
      while (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value!);
      return result;
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, { promise, listeners });
    return promise;
  }

  clear(cacheKey?: string) {
    if (cacheKey !== undefined) this.cache.delete(cacheKey);
    else this.cache.clear();
  }

  dispose() {
    if (this.worker && this.options.disposeMessage !== undefined) {
      this.worker.postMessage(this.options.disposeMessage);
    }
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending(new Error(`${this.options.defaultErrorMessage} was canceled.`));
    this.inFlight.clear();
    this.cache.clear();
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.options.createWorker();
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const requestId = Number(event.data.requestId);
      const pending = this.pending.get(requestId);
      if (!pending) return;
      if (event.data.type === 'status') {
        pending.publishProgress({
          status: String(event.data.status ?? 'working'),
          message: typeof event.data.message === 'string' ? event.data.message : undefined,
          progress: typeof event.data.progress === 'number' ? event.data.progress : undefined
        });
        return;
      }
      this.pending.delete(requestId);
      if (event.data.type === 'error') {
        pending.reject(new Error(
          typeof event.data.message === 'string'
            ? event.data.message
            : this.options.defaultErrorMessage
        ));
        return;
      }
      try {
        pending.resolve(this.options.parseResult(event.data));
      } catch (reason) {
        pending.reject(reason instanceof Error ? reason : new Error(this.options.defaultErrorMessage));
      }
    };
    worker.onerror = (event) => {
      this.rejectPending(new Error(event.message || this.options.defaultErrorMessage));
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
