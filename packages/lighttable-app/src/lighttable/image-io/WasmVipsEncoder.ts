import { getAdvancedImageIoCapabilities } from './advancedImageIoCapabilities';
import type { NativeBitmapFormatId } from './nativeBitmapFormats';
import type { WasmVipsWorkerRequest, WasmVipsWorkerResponse } from './wasmVipsProtocol';

export interface NativeBitmapPixelBuffer {
  readonly pixels: Uint8Array | Uint8ClampedArray | Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly storage: 'u8' | 'u16' | 'f16-display';
}

interface PendingEncode {
  resolve(value: Blob): void;
  reject(reason: Error): void;
}

export class WasmVipsEncoder {
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingEncode>();
  private disposed = false;

  async encode(
    input: NativeBitmapPixelBuffer,
    format: NativeBitmapFormatId,
    signal?: AbortSignal
  ): Promise<Blob> {
    if (this.disposed) throw new Error('The native bitmap encoder is closed.');
    const capabilities = getAdvancedImageIoCapabilities();
    if (!capabilities.available) {
      throw new Error(`Native bitmap encoding is unavailable: ${capabilities.reasons.join(' ')}`);
    }
    if (signal?.aborted) throw new DOMException('Bitmap encoding was cancelled.', 'AbortError');
    const requestId = ++this.requestId;
    const pixels = input.pixels.buffer.slice(
      input.pixels.byteOffset,
      input.pixels.byteOffset + input.pixels.byteLength
    ) as ArrayBuffer;
    return new Promise<Blob>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId);
        reject(new DOMException('Bitmap encoding was cancelled.', 'AbortError'));
        this.resetWorker();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve: (value) => { signal?.removeEventListener('abort', abort); resolve(value); },
        reject: (error) => { signal?.removeEventListener('abort', abort); reject(error); }
      });
      const request: WasmVipsWorkerRequest = {
        kind: 'encode', requestId, pixels,
        width: input.width, height: input.height, storage: input.storage, format
      };
      try {
        this.getWorker().postMessage(request, [pixels]);
      } catch (reason) {
        this.pending.delete(requestId);
        signal?.removeEventListener('abort', abort);
        reject(reason instanceof Error ? reason : new Error('Native bitmap encoding failed.'));
      }
    });
  }

  destroy() {
    this.disposed = true;
    this.resetWorker(new Error('The native bitmap encoder was closed.'));
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./wasmVips.worker.ts', import.meta.url), {
      type: 'module', name: 'LightTable native bitmap codec'
    });
    worker.onmessage = ({ data }: MessageEvent<WasmVipsWorkerResponse>) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.kind === 'error') pending.reject(new Error(data.message));
      else if (data.kind === 'encoded') pending.resolve(new Blob([data.bytes]));
      else pending.reject(new Error('The bitmap codec returned a decode result for an encode request.'));
    };
    worker.onerror = (event) => this.resetWorker(new Error(
      event.message || 'The native bitmap codec worker stopped unexpectedly.'
    ));
    worker.onmessageerror = () => this.resetWorker(new Error(
      'The native bitmap codec worker returned an unreadable response.'
    ));
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error = new DOMException('Bitmap encoding was cancelled.', 'AbortError')) {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach(({ reject }) => reject(reason));
  }
}
