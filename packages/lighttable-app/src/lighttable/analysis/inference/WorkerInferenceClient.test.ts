import { describe, expect, it, vi } from 'vitest';
import { WorkerInferenceClient } from './WorkerInferenceClient';

class FakeWorker {
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

const createClient = (worker: FakeWorker, cacheSize = 2) => new WorkerInferenceClient<number, number>({
  createWorker: () => worker as unknown as Worker,
  createRequest: (requestId, input) => ({ type: 'run', requestId, input }),
  parseResult: (message) => Number(message.value),
  cacheSize,
  disposeMessage: { type: 'dispose' },
  defaultErrorMessage: 'Inference failed'
});

describe('WorkerInferenceClient', () => {
  it('shares in-flight work and caches the parsed result', async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const first = client.run(4, 'same');
    const second = client.run(99, 'same');
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.onmessage?.({ data: { type: 'result', requestId: 1, value: 8 } } as MessageEvent);
    await expect(Promise.all([first, second])).resolves.toEqual([8, 8]);
    await expect(client.run(2, 'same')).resolves.toBe(8);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('fans progress out to every listener sharing a request', async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const first = client.run(1, 'same', firstProgress);
    const second = client.run(1, 'same', secondProgress);
    worker.onmessage?.({
      data: { type: 'status', requestId: 1, status: 'loading', progress: 25 }
    } as MessageEvent);
    expect(firstProgress).toHaveBeenCalledWith({ status: 'loading', progress: 25 });
    expect(secondProgress).toHaveBeenCalledWith({ status: 'loading', progress: 25 });
    worker.onmessage?.({ data: { type: 'result', requestId: 1, value: 3 } } as MessageEvent);
    await Promise.all([first, second]);
  });

  it('rejects pending work and terminates the worker on dispose', async () => {
    const worker = new FakeWorker();
    const client = createClient(worker);
    const pending = client.run(1, 'one');
    client.dispose();
    await expect(pending).rejects.toThrow('Inference failed was canceled.');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
