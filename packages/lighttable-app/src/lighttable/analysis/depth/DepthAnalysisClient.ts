import type { DepthAnalysisProgress, DepthAnalysisResult } from './types';

interface PendingRequest {
  resolve: (result: DepthAnalysisResult) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: DepthAnalysisProgress) => void;
}

interface InFlightAnalysis {
  promise: Promise<DepthAnalysisResult>;
  listeners: Set<(progress: DepthAnalysisProgress) => void>;
}

export class DepthAnalysisClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly cache = new Map<string, DepthAnalysisResult>();
  private readonly inFlight = new Map<string, InFlightAnalysis>();

  async estimate(source: Blob, cacheKey: string, onProgress?: (progress: DepthAnalysisProgress) => void) {
    const cached = this.cache.get(cacheKey);
    if (cached) {
      onProgress?.({ status: 'ready', message: 'Depth ready' });
      return cached;
    }
    const running = this.inFlight.get(cacheKey);
    if (running) {
      if (onProgress) running.listeners.add(onProgress);
      return await running.promise;
    }
    const worker = this.ensureWorker();
    const requestId = ++this.requestId;
    const listeners = new Set<(progress: DepthAnalysisProgress) => void>();
    if (onProgress) listeners.add(onProgress);
    const promise = new Promise<DepthAnalysisResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onProgress: (progress) => listeners.forEach((listener) => listener(progress))
      });
      worker.postMessage({ type: 'estimate', requestId, source });
    }).then((result) => {
      this.cache.set(cacheKey, result);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
      return result;
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, { promise, listeners });
    return await promise;
  }

  clear(cacheKey?: string) {
    if (cacheKey) this.cache.delete(cacheKey);
    else this.cache.clear();
  }

  dispose() {
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Depth analysis was canceled.'));
    this.pending.clear();
    this.inFlight.clear();
    this.cache.clear();
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const requestId = Number(event.data.requestId);
      const pending = this.pending.get(requestId);
      if (!pending) return;
      if (event.data.type === 'status') {
        pending.onProgress?.({
          status: event.data.status as DepthAnalysisProgress['status'],
          message: typeof event.data.message === 'string' ? event.data.message : undefined,
          progress: typeof event.data.progress === 'number' ? event.data.progress : undefined
        });
        return;
      }
      this.pending.delete(requestId);
      if (event.data.type === 'error') {
        pending.reject(new Error(typeof event.data.message === 'string' ? event.data.message : 'Depth estimation failed.'));
        return;
      }
      const data = new Float32Array(event.data.data as ArrayBuffer);
      pending.resolve({
        width: Number(event.data.width),
        height: Number(event.data.height),
        data,
        nearIsOne: true
      });
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Depth analysis worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}

// The worker/model is deliberately shared across LightTable overlay sessions.
// Closing an editor frees GPU depth textures, but does not redownload the model.
export const lightTableDepthAnalysis = new DepthAnalysisClient();
