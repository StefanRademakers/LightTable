import { describe, expect, it, vi } from 'vitest';
import { TextEngineClient, type TextEngineWorkerPort } from './TextEngineClient';
import { TEXT_ENGINE_PROTOCOL_VERSION } from './textEngineProtocol';

class FakeWorker implements TextEngineWorkerPort {
  onmessage: TextEngineWorkerPort['onmessage'] = null;
  onerror: TextEngineWorkerPort['onerror'] = null;
  onmessageerror: TextEngineWorkerPort['onmessageerror'] = null;
  readonly postMessage = vi.fn<TextEngineWorkerPort['postMessage']>();
  readonly terminate = vi.fn();

  ready(requestId: number) {
    this.onmessage?.({
      data: {
        kind: 'ready',
        protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
        requestId,
        engineVersion: '0.1.0',
        loadDurationMs: 4.5
      }
    } as MessageEvent);
  }

  inspected(requestId: number) {
    this.onmessage?.({
      data: {
        kind: 'font-inspected',
        protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
        requestId,
        glyphCount: 625,
        unitsPerEm: 1_000,
        axisCount: 2,
        outline: 'cff2',
        embeddingLevel: 'editable',
        noSubsetting: false,
        bitmapOnly: false
      }
    } as MessageEvent);
  }
}

describe('TextEngineClient', () => {
  it('does not create a worker until the first explicit probe', () => {
    const factory = vi.fn(() => new FakeWorker());
    new TextEngineClient(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns a rejected promise when worker construction fails synchronously', async () => {
    const client = new TextEngineClient(() => {
      throw new Error('Worker blocked by CSP');
    });
    await expect(client.probe()).rejects.toThrow('Worker blocked by CSP');
  });

  it('deduplicates concurrent probes and reuses the successful capability', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const client = new TextEngineClient(factory);

    const first = client.probe();
    const second = client.probe();
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.ready(1);

    await expect(first).resolves.toEqual({ engineVersion: '0.1.0', loadDurationMs: 4.5 });
    await expect(client.probe()).resolves.toEqual({ engineVersion: '0.1.0', loadDurationMs: 4.5 });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('reports worker failures and can retry with a fresh worker', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const client = new TextEngineClient(factory);

    const failed = client.probe();
    firstWorker.onerror?.({ message: 'WASM failed' } as ErrorEvent);
    await expect(failed).rejects.toThrow('WASM failed');
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    const retried = client.probe();
    secondWorker.ready(2);
    await expect(retried).resolves.toMatchObject({ engineVersion: '0.1.0' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('transfers font bytes to the persistent worker and returns inspected metadata', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);

    const inspection = client.inspectFont(new Uint8Array([0, 1, 0, 0]), 2);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inspect-font', faceIndex: 2 }),
      [expect.any(ArrayBuffer)]
    );
    worker.inspected(1);

    await expect(inspection).resolves.toMatchObject({
      glyphCount: 625,
      outline: 'cff2',
      embeddingLevel: 'editable'
    });
  });

  it('terminates the worker and rejects pending probes on dispose', async () => {
    const worker = new FakeWorker();
    const client = new TextEngineClient(() => worker);
    const pending = client.probe();
    client.dispose();
    await expect(pending).rejects.toThrow('canceled');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not let a disposed probe clear a new in-flight retry', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const factory = vi.fn()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const client = new TextEngineClient(factory);

    const disposed = client.probe();
    client.dispose();
    const retry = client.probe();
    await expect(disposed).rejects.toThrow('canceled');
    const concurrent = client.probe();
    expect(concurrent).toBe(retry);
    expect(secondWorker.postMessage).toHaveBeenCalledTimes(1);
    secondWorker.ready(2);
    await expect(retry).resolves.toMatchObject({ engineVersion: '0.1.0' });
  });
});
