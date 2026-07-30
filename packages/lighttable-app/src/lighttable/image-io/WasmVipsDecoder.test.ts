import { afterEach, describe, expect, it, vi } from 'vitest';
import { WasmVipsDecoder } from './WasmVipsDecoder';

const workerInstances: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    workerInstances.push(this);
  }
}

const enableCapabilities = () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class SharedArrayBuffer {});
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(WebAssembly, 'validate').mockReturnValue(true);
};

describe('LightTable wasm-vips decoder boundary', () => {
  afterEach(() => {
    workerInstances.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fails before copying the blob or creating a worker when capabilities are unavailable', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    vi.stubGlobal('SharedArrayBuffer', undefined);
    vi.stubGlobal('Worker', undefined);
    const arrayBuffer = vi.fn();
    const blob = { arrayBuffer, type: 'image/png' } as unknown as Blob;

    await expect(new WasmVipsDecoder().decode(blob)).rejects.toThrow('unavailable');

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(workerInstances).toHaveLength(0);
  });

  it('transfers the source buffer and resolves the matching worker response', async () => {
    enableCapabilities();
    const bytes = new ArrayBuffer(8);
    const decoder = new WasmVipsDecoder();
    const resultPromise = decoder.decode({
      type: 'image/png',
      arrayBuffer: vi.fn().mockResolvedValue(bytes)
    } as unknown as Blob);
    await Promise.resolve();
    const worker = workerInstances[0];
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'decode', requestId: 1, bytes }),
      [bytes]
    );
    const pixels = new ArrayBuffer(16);
    worker.onmessage?.({
      data: {
        kind: 'decoded',
        requestId: 1,
        pixels,
        descriptor: {
          width: 1,
          height: 1,
          channels: 4,
          storage: 'u16',
          colorSpace: 'srgb',
          transferFunction: 'srgb',
          alphaMode: 'straight',
          orientationApplied: true,
          sourceBitDepth: 16,
          contentType: 'image/png',
          sourceFormat: 'ushort',
          sourceInterpretation: 'rgb16',
          sourceProfile: 'assumed-srgb',
          iccProfile: null,
          iccProfileAppliedToSrgb: false
        }
      }
    } as MessageEvent);

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      kind: 'advanced-pixels',
      pixels
    }));
  });

  it('terminates the optional worker and rejects pending work on cancellation', async () => {
    enableCapabilities();
    const decoder = new WasmVipsDecoder();
    const controller = new AbortController();
    const resultPromise = decoder.decode({
      type: 'image/tiff',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
    } as unknown as Blob, controller.signal);
    await Promise.resolve();
    const worker = workerInstances[0];

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('preserves worker startup diagnostics when the worker crashes', async () => {
    enableCapabilities();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const decoder = new WasmVipsDecoder();
    const resultPromise = decoder.decode({
      type: 'image/tiff',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
    } as unknown as Blob);
    await Promise.resolve();
    const worker = workerInstances[0];

    worker.onerror?.({
      message: 'SharedArrayBuffer is not defined',
      filename: 'wasmVips.worker.js',
      lineno: 12,
      colno: 4
    } as ErrorEvent);

    await expect(resultPromise).rejects.toThrow(
      'SharedArrayBuffer is not defined (wasmVips.worker.js:12:4)'
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
