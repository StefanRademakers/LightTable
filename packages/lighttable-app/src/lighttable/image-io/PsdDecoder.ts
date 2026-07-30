import type { PsdDecodeSuccess, PsdWorkerResponse } from './psdProtocol';

interface PendingDecode {
  resolve(value: PsdDecodeSuccess): void;
  reject(reason: Error): void;
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
  return event.message?.trim() || nestedMessage || `unknown worker error${location}`;
};

export class PsdDecoder {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingDecode>();

  async decode(blob: Blob, signal?: AbortSignal): Promise<PsdDecodeSuccess> {
    if (signal?.aborted) throw new DOMException('The PSD import was cancelled.', 'AbortError');
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('PSD semantic import requires Web Workers and OffscreenCanvas.');
    }
    const bytes = await blob.arrayBuffer();
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
        resolve: (value) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', abort);
          reject(reason);
        }
      });
      worker.postMessage({ kind: 'decode-psd', requestId, bytes }, [bytes]);
    });
  }

  destroy() {
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
      this.pending.delete(data.requestId);
      if (data.kind === 'error') pending.reject(new Error(data.message));
      else pending.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.resetWorker(new Error(
        `The PSD decoder worker failed: ${describeWorkerError(event)}.`
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
