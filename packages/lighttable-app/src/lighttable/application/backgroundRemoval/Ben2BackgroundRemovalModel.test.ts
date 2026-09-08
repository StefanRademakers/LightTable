import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ben2BackgroundRemovalModel } from './Ben2BackgroundRemovalModel';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  lastRequest: Record<string, unknown> | null = null;
  terminate = vi.fn();

  constructor() { FakeWorker.instances.push(this); }
  postMessage(value: Record<string, unknown>) { this.lastRequest = value; }
  complete() {
    const requestId = this.lastRequest?.requestId;
    const mask = new Uint8Array([255]).buffer;
    const event = { data: { type: 'result', requestId, mask, width: 1, height: 1,
      modelId: 'ben2', backend: 'wasm', durationMs: 1 } } as any;
    this.onmessage?.(event);
  }
}

describe('Ben2BackgroundRemovalModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
  });

  it('creates a fresh inference client after cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const model = new Ben2BackgroundRemovalModel();
    const cancellation = new AbortController();
    const first = model.remove(new Blob(['first']), { signal: cancellation.signal });
    cancellation.abort();
    await expect(first).rejects.toThrow('canceled');

    const second = model.remove(new Blob(['second']));
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1]!.complete();
    await expect(second).resolves.toMatchObject({ modelId: 'ben2', mask: { width: 1, height: 1 } });
    model.dispose();
  });
});
