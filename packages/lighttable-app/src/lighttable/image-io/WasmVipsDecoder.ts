import type { AdvancedDecodedImage } from './types';
import { getAdvancedImageIoCapabilities } from './advancedImageIoCapabilities';
import type { WasmVipsWorkerRequest, WasmVipsWorkerResponse } from './wasmVipsProtocol';

interface PendingDecode {
  resolve(value: AdvancedDecodedImage): void;
  reject(reason: Error): void;
}

export class WasmVipsDecoder {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingDecode>();

  async decode(blob: Blob, signal?: AbortSignal): Promise<AdvancedDecodedImage> {
    const capabilities = getAdvancedImageIoCapabilities();
    if (!capabilities.available) {
      throw new Error(`Precision-preserving image decode is unavailable: ${capabilities.reasons.join(' ')}`);
    }
    if (signal?.aborted) throw new DOMException('The image decode was cancelled.', 'AbortError');

    const worker = this.getWorker();
    const requestId = ++this.requestId;
    const bytes = await blob.arrayBuffer();
    if (signal?.aborted) throw new DOMException('The image decode was cancelled.', 'AbortError');

    return new Promise<AdvancedDecodedImage>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId);
        reject(new DOMException('The image decode was cancelled.', 'AbortError'));
        // libvips evaluation cannot be interrupted safely. Terminating the
        // optional worker contains the work without affecting native loading.
        this.resetWorker();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve: (value) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        }
      });
      const request: WasmVipsWorkerRequest = {
        kind: 'decode',
        requestId,
        bytes,
        contentType: blob.type || 'application/octet-stream'
      };
      worker.postMessage(request, [bytes]);
    });
  }

  destroy() {
    this.resetWorker(new Error('The precision-preserving image decoder was closed.'));
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./wasmVips.worker.ts', import.meta.url), {
      type: 'module',
      name: 'LightTable advanced image I/O'
    });
    worker.onmessage = ({ data }: MessageEvent<WasmVipsWorkerResponse>) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.kind === 'error') {
        pending.reject(new Error(data.message));
      } else if (data.kind === 'decoded') {
        pending.resolve({
          kind: 'advanced-pixels',
          pixels: data.pixels,
          descriptor: data.descriptor
        });
      } else {
        pending.reject(new Error('The image codec returned an encode result for a decode request.'));
      }
    };
    worker.onerror = (event) => {
      const location = event.filename
        ? ` (${event.filename}${event.lineno ? `:${event.lineno}${event.colno ? `:${event.colno}` : ''}` : ''})`
        : '';
      const detail = event.message?.trim() || 'Unknown worker startup error';
      console.error('LightTable precision decoder worker error', event);
      this.resetWorker(new Error(
        `The precision-preserving image decoder worker failed: ${detail}${location}`
      ));
    };
    worker.onmessageerror = (event) => {
      console.error('LightTable precision decoder worker message error', event);
      this.resetWorker(new Error(
        'The precision-preserving image decoder worker returned an unreadable response.'
      ));
    };
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error = new DOMException('The image decode was cancelled.', 'AbortError')) {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach(({ reject }) => reject(reason));
  }
}
