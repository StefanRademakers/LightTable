import { describe, expect, it, vi } from 'vitest';
import type { GenAiProviderId, GenAiProviderSnapshot } from '@lighttable/genai-core';
import { GenAiProviderController, type GenAiProviderService } from './GenAiProviderController';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = (status: GenAiProviderSnapshot['status'], id = 'openart', message?: string): GenAiProviderSnapshot =>
  ({ id: id as GenAiProviderId, label: id, status, message });
const setup = () => {
  const initial = deferred<readonly GenAiProviderSnapshot[]>(), listeners: ((s: GenAiProviderSnapshot) => void)[] = [];
  const pending: ReturnType<typeof deferred<GenAiProviderSnapshot>>[] = [];
  const request = vi.fn((_id: GenAiProviderId) => { const next = deferred<GenAiProviderSnapshot>(); pending.push(next); return next.promise; });
  const unsubscribe = vi.fn();
  const service: GenAiProviderService = { getProviderSnapshots: vi.fn(() => initial.promise),
    subscribe: vi.fn(listener => { listeners.push(listener); return unsubscribe; }),
    connectProvider: request, disconnectProvider: request };
  let bound = true, report = vi.fn();
  const owner = new GenAiProviderController(service, undefined, () => bound, () => report);
  return { owner, initial, pending, service, request, unsubscribe, listeners,
    emit: (s: GenAiProviderSnapshot) => listeners.at(-1)!(s), retire: () => { bound = false; },
    get report() { return report; }, replaceReport: () => { report = vi.fn(); return report; } };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('GenAiProviderController', () => {
  it('has honest cached placeholders, and only Create preference chooses the panel provider', () => {
    const f = setup(), opening = f.owner.getSnapshot();
    expect(f.service.getProviderSnapshots).not.toHaveBeenCalled();
    expect(opening.provider).toMatchObject({ id: 'openart', status: 'disconnected', label: 'OpenArt' });
    expect(f.owner.getSnapshot()).toBe(opening);
    f.owner.setPreferences({ createProviderId: 'lighttable-local', editProviderId: 'higgsfield' });
    expect(f.owner.getSnapshot()).toMatchObject({ selectedProviderId: 'lighttable-local', editProviderId: 'higgsfield',
      provider: { label: 'Free Local AI' } });
    f.owner.setPreferences({ createProviderId: 'higgsfield', editProviderId: 'openart' });
    expect(f.owner.getSnapshot().provider.label).toBe('Higgsfield');
  });
  it('keeps newer subscription/request information over the initial list and avoids duplicate notifications', async () => {
    const f = setup(); f.owner.start(); const changed = vi.fn(); f.owner.subscribe(changed);
    f.emit(snapshot('connected')); const current = f.owner.getSnapshot(); f.emit(snapshot('connected'));
    expect(f.owner.getSnapshot()).toBe(current); expect(changed).toHaveBeenCalledOnce();
    f.initial.resolve([snapshot('disconnected')]); await flush();
    expect(f.owner.getSnapshot()).toBe(current);
    const g = setup(); g.owner.start(); const request = g.owner.connectSelected();
    g.initial.resolve([snapshot('expired')]); await flush();
    expect(g.owner.getSnapshot().provider.status).toBe('disconnected');
    g.pending[0]!.resolve(snapshot('connected')); await request;
    expect(g.owner.getSnapshot().provider.status).toBe('connected');
  });
  it('shows current initial failures but suppresses old initial/subscription delivery after rearm', async () => {
    const f = setup(), cleanup = f.owner.start(); cleanup(); f.owner.start(); cleanup();
    f.listeners[0]!(snapshot('connected')); expect(f.owner.getSnapshot().provider.status).toBe('disconnected');
    f.initial.reject(new Error('Initial failure')); await flush();
    expect(f.owner.getSnapshot().provider).toMatchObject({ status: 'error', message: 'Initial failure' });
    expect(f.report).not.toHaveBeenCalled();
  });
  it.each(['reject', 'error-result'] as const)('reports %s once and permits explicit retry/disconnect', async kind => {
    const f = setup(); f.owner.start(); const first = f.owner.connectSelected();
    if (kind === 'reject') f.pending[0]!.reject(new Error('Connection rejected'));
    else f.pending[0]!.resolve(snapshot('error', 'openart', 'Connection rejected'));
    await first; expect(f.report).toHaveBeenCalledExactlyOnceWith('Connection rejected');
    expect(f.owner.getSnapshot().provider).toMatchObject({ status: 'error', message: 'Connection rejected' });
    const retry = f.owner.connectSelected(); f.pending[1]!.resolve(snapshot('connected')); await retry;
    const disconnect = f.owner.disconnectOpenArt(); f.pending[2]!.resolve(snapshot('disconnected')); await disconnect;
    expect(f.owner.getSnapshot().provider).toMatchObject({ status: 'disconnected', message: undefined });
  });
  it.each(['connected', 'reject'] as const)('ignores an older request %s after newer same-provider disconnect', async result => {
    const f = setup(); f.owner.start(); const first = f.owner.connectSelected(), second = f.owner.disconnectOpenArt();
    f.pending[1]!.resolve(snapshot('disconnected')); await second;
    if (result === 'reject') f.pending[0]!.reject(new Error('Old failure')); else f.pending[0]!.resolve(snapshot('connected'));
    await first; expect(f.owner.getSnapshot().provider.status).toBe('disconnected'); expect(f.report).not.toHaveBeenCalled();
  });
  it('keeps requests independent across providers and pins invocation provider/reporter', async () => {
    const f = setup(); f.owner.start(); const originalReport = f.report, first = f.owner.connectSelected();
    const latestReport = f.replaceReport(); f.owner.setPreferences({ createProviderId: 'higgsfield', editProviderId: 'openart' });
    const second = f.owner.connectSelected();
    expect(f.request.mock.calls.map(([id]) => id)).toEqual(['openart', 'higgsfield']);
    f.pending[0]!.reject(new Error('OpenArt error')); f.pending[1]!.reject(new Error('Higgsfield error')); await Promise.all([first, second]);
    expect(originalReport).toHaveBeenCalledExactlyOnceWith('OpenArt error');
    expect(latestReport).toHaveBeenCalledExactlyOnceWith('Higgsfield error');
  });
  it.each(['connected', 'disconnected', 'reject'] as const)('retains terminal event error over returned %s and reports that winning error once', async result => {
    const f = setup(); f.owner.start(); const request = f.owner.connectSelected();
    f.emit(snapshot('error', 'openart', 'Observed error'));
    if (result === 'reject') f.pending[0]!.reject(new Error('Older error'));
    else f.pending[0]!.resolve(snapshot(result));
    await request; expect(f.owner.getSnapshot().provider).toMatchObject({ status: 'error', message: 'Observed error' });
    expect(f.report).toHaveBeenCalledExactlyOnceWith('Observed error');
  });
  it.each(['expired', 'disconnected'] as const)('retains observed %s over old connected response', async status => {
    const f = setup(); f.owner.start(); const request = f.owner.connectSelected();
    f.emit(snapshot(status)); const current = f.owner.getSnapshot(); f.pending[0]!.resolve(snapshot('connected')); await request;
    expect(f.owner.getSnapshot()).toBe(current); expect(f.report).not.toHaveBeenCalled();
  });
  it.each(['connected', 'reject'] as const)('allows connecting progress followed by returned %s', async result => {
    const f = setup(); f.owner.start(); const request = f.owner.connectSelected(); f.emit(snapshot('connecting'));
    if (result === 'reject') f.pending[0]!.reject(new Error('Failed')); else f.pending[0]!.resolve(snapshot('connected'));
    await request; expect(f.owner.getSnapshot().provider.status).toBe(result === 'reject' ? 'error' : 'connected');
  });
  it('preserves own terminal event without duplicate publication and rejects wrong-provider results', async () => {
    const f = setup(); f.owner.start(); const request = f.owner.connectSelected(); f.emit(snapshot('connected'));
    const current = f.owner.getSnapshot(); f.pending[0]!.resolve(snapshot('connected')); await request;
    expect(f.owner.getSnapshot()).toBe(current);
    const invalid = f.owner.connectSelected(); f.pending[1]!.resolve(snapshot('connected', 'higgsfield')); await invalid;
    expect(f.owner.getSnapshot().provider.status).toBe('error'); expect(f.report).toHaveBeenCalledOnce();
  });
  it('retires pending requests on cleanup and does not revive them on StrictMode rearm', async () => {
    const f = setup(), cleanup = f.owner.start(), pending = f.owner.connectSelected(); cleanup();
    await f.owner.connectSelected(); expect(f.request).toHaveBeenCalledOnce(); f.owner.start();
    f.pending[0]!.reject(new Error('Retired')); await pending; expect(f.report).not.toHaveBeenCalled();
    expect(f.owner.getSnapshot().provider.status).toBe('disconnected');
  });
  it('rechecks after synchronous publication before reporting or applying the rest of the initial list', async () => {
    const f = setup(); f.owner.start(); f.owner.subscribe(f.retire);
    const request = f.owner.connectSelected(); f.pending[0]!.reject(new Error('Failure')); await request;
    expect(f.report).not.toHaveBeenCalled();
    const g = setup(); g.owner.start(); g.owner.subscribe(g.retire);
    g.initial.resolve([snapshot('connected'), snapshot('connected', 'higgsfield')]); await flush();
    g.owner.setPreferences({ createProviderId: 'higgsfield', editProviderId: 'openart' });
    expect(g.owner.getSnapshot().provider.status).toBe('disconnected');
  });
  it('does not admit retained callbacks without a bound service', async () => {
    const report = vi.fn(), owner = new GenAiProviderController(undefined, undefined, () => true, () => report);
    owner.start(); await owner.connectSelected(); expect(owner.getSnapshot().provider.status).toBe('disconnected');
    const f = setup(); f.owner.start(); f.retire(); await f.owner.connectSelected(); expect(f.request).not.toHaveBeenCalled();
  });
});
