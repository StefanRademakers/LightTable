import type {
  PsdDecodeStage,
  PsdDecodeSuccess,
  PsdWorkerResponse
} from './psdProtocol';

interface PendingDecode {
  resolve(value: PsdDecodeSuccess): void;
  reject(reason: Error): void;
  stage: PsdDecodeStage | 'worker-created';
}

const describeWorkerError = (event: ErrorEvent) => {
  const nested = event.error;
  const nestedMessage = nested instanceof Error
    ? `${nested.name}: ${nested.message}`
    : typeof nested === 'string'
      ? nested
      : '';
  const location = event.filename
    ? ` (${event.filename}${event.lineno ? `:${event.lineno}${event.colno ? `:${event.colno}` : ''}` : ''})`
    : '';
  const message = event.message?.trim() || nestedMessage || 'unknown worker error';
  return `${message}${location}`;
};

export class PsdDecoder {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingDecode>();
  private disposed = false;

  async decode(blob: Blob, signal?: AbortSignal): Promise<PsdDecodeSuccess> {
    if (this.disposed) throw new Error('The PSD decoder is closed.');
    if (signal?.aborted) throw new DOMException('The PSD import was cancelled.', 'AbortError');
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('PSD semantic import requires Web Workers and OffscreenCanvas.');
    }
    const bytes = await blob.arrayBuffer();
    if (this.disposed) throw new Error('The PSD decoder is closed.');
    if (signal?.aborted) throw new DOMException('The PSD import was cancelled.', 'AbortError');
    const requestId = ++this.requestId;
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId);
        reject(new DOMException('The PSD import was cancelled.', 'AbortError'));
        this.resetWorker();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        stage: 'worker-created',
        resolve: (value) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', abort);
          reject(reason);
        }
      });
      try {
        worker.postMessage({ kind: 'decode-psd', requestId, bytes }, [bytes]);
      } catch (reason) {
        this.pending.delete(requestId);
        signal?.removeEventListener('abort', abort);
        reject(reason instanceof Error ? reason : new Error('PSD import failed to start.'));
      }
    });
  }

  destroy() {
    this.disposed = true;
    this.resetWorker(new Error('The PSD decoder was closed.'));
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), {
      type: 'module',
      name: 'LightTable PSD semantic import'
    });
    worker.onmessage = ({ data }: MessageEvent<PsdWorkerResponse>) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      if (data.kind === 'progress') {
        pending.stage = data.stage;
        return;
      }
      this.pending.delete(data.requestId);
      if (data.kind === 'error') pending.reject(new Error(data.message));
      else pending.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      const stages = [...this.pending.values()]
        .map(({ stage }) => stage)
        .filter((stage, index, values) => values.indexOf(stage) === index)
        .join(', ');
      this.resetWorker(new Error(
        `The PSD decoder worker failed after ${stages || 'worker creation'}: `
        + `${describeWorkerError(event)}.`
      ));
    };
    worker.onmessageerror = () => {
      this.resetWorker(new Error('The PSD decoder returned an unreadable response.'));
    };
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error = new DOMException('The PSD import was cancelled.', 'AbortError')) {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach(({ reject }) => reject(reason));
  }
}
