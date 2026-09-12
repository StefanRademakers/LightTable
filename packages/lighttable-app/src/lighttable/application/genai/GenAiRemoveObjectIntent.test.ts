import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightTableGenAiService } from '../../../platform/LightTableHost';
import { executeRemoveObject } from '../../../genai/application/removeObjectCommand';
import { GenAiRemoveObjectIntent, type RemoveObjectRequestContext } from './GenAiRemoveObjectIntent';
vi.mock('../../../genai/application/removeObjectCommand', () => ({ executeRemoveObject: vi.fn() }));
const execute = vi.mocked(executeRemoveObject);
const deferred = () => {
  let resolve!: (value: never) => void, reject!: (reason: Error) => void;
  const promise = new Promise<never>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve: () => resolve({ status: 'submitted' } as never), reject };
};
beforeEach(() => { execute.mockReset(); execute.mockResolvedValue({ status: 'submitted' } as never); });
const setup = () => {
  let identity = {};
  const error = vi.fn(), status = vi.fn();
  const capture = vi.fn((): RemoveObjectRequestContext => {
    const opening = identity;
    return { service: {} as LightTableGenAiService, projectId: 'project',
      isCurrent: () => opening === identity, prepareSource: vi.fn() };
  });
  const owner = new GenAiRemoveObjectIntent({ capture, error, status });
  return { owner, capture, error, status, retire: () => { identity = {}; } };
};
describe('GenAiRemoveObjectIntent', () => {
  it('does not capture through an unmounted or disconnected retained callback', async () => {
    const f = setup(), run = f.owner.run;
    await run(); const disconnect = f.owner.connect(); disconnect(); await run();
    expect(f.capture).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('deduplicates only a still-current pending request', async () => {
    const f = setup(), old = deferred(); execute.mockReturnValueOnce(old.promise); f.owner.connect();
    const pending = f.owner.run(); await f.owner.run();
    expect(execute).toHaveBeenCalledOnce(); old.resolve(); await pending;
    expect(f.status).toHaveBeenLastCalledWith('Remove Object submitted.');
    await f.owner.run(); expect(execute).toHaveBeenCalledTimes(2);
  });
  it.each(['resolve', 'reject'] as const)('stale %s/finally cannot clear a successor or publish status', async terminal => {
    const f = setup(), a = deferred(), b = deferred();
    execute.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise); f.owner.connect();
    const old = f.owner.run(); f.retire(); const next = f.owner.run();
    f.error.mockClear(); f.status.mockClear();
    if (terminal === 'resolve') a.resolve(); else a.reject(new Error('Old failure'));
    await old; await f.owner.run();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(f.error).not.toHaveBeenCalled(); expect(f.status).not.toHaveBeenCalled();
    b.resolve(); await next; expect(f.status).toHaveBeenCalledExactlyOnceWith('Remove Object submitted.');
  });
  it('StrictMode reconnect permits fresh work without reviving old authority', async () => {
    const f = setup(), old = deferred(); execute.mockReturnValueOnce(old.promise);
    const disconnect = f.owner.connect(), pending = f.owner.run();
    const oldOptions = execute.mock.calls[0]![0];
    disconnect(); f.owner.connect();
    expect(() => oldOptions.assertCurrent()).toThrow('retired');
    await f.owner.run(); f.status.mockClear(); old.resolve(); await pending;
    expect(f.status).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(2);
  });
  it('reports current failures and releases the attempt for explicit retry', async () => {
    const f = setup(); execute.mockRejectedValueOnce(new Error('Provider failed')); f.owner.connect();
    await f.owner.run(); expect(f.error).toHaveBeenLastCalledWith('Provider failed');
    expect(f.status).toHaveBeenLastCalledWith(null);
    await f.owner.run(); expect(execute).toHaveBeenCalledTimes(2);
    expect(f.error).toHaveBeenLastCalledWith(null);
  });
  it('reports invalid current capture without starting provider work', async () => {
    const f = setup(); f.capture.mockImplementation(() => { throw new Error('Select an area'); });
    f.owner.connect(); await f.owner.run();
    expect(f.error).toHaveBeenCalledExactlyOnceWith('Select an area'); expect(execute).not.toHaveBeenCalled();
  });
});
