import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenAiProviderSnapshot } from '@lighttable/genai-core';
import type { GenAiProviderService } from './GenAiProviderController';
import { useGenAiProviders } from './useGenAiProviders';

// Simulated React commit scheduling around the real provider owner; no DOM/runtime claim.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!old || deps.some((value, i) => value !== old.deps[i])) hooks.slots[index] = { deps, value: factory() };
    return (hooks.slots[index] as { value: unknown }).value;
  },
  useLayoutEffect: (setup: () => void | (() => void), deps: readonly unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { deps: readonly unknown[]; cleanup?: () => void } | undefined;
    if (!old || deps.some((value, i) => value !== old.deps[i])) hooks.effects.push(() => {
      old?.cleanup?.(); const cleanup = setup(); hooks.slots[index] = { deps, cleanup };
    });
  },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
const serviceFixture = () => {
  const initial = deferred<readonly GenAiProviderSnapshot[]>(), request = deferred<GenAiProviderSnapshot>();
  let listener!: (snapshot: GenAiProviderSnapshot) => void;
  const service: GenAiProviderService = { getProviderSnapshots: vi.fn(() => initial.promise),
    connectProvider: vi.fn(() => request.promise), disconnectProvider: vi.fn(() => request.promise),
    subscribe: vi.fn(next => { listener = next; return vi.fn(); }) };
  return { service, initial, request, emit: (snapshot: GenAiProviderSnapshot) => listener(snapshot) };
};
const connected = { id: 'openart', label: 'OpenArt', status: 'connected' } as GenAiProviderSnapshot;
const commit = () => { hooks.effects.splice(0).forEach(effect => effect()); };
const unmount = () => hooks.slots.forEach(slot => (slot as { cleanup?: () => void })?.cleanup?.());
const render = (service: GenAiProviderService, report = vi.fn(), createProviderId = 'openart', editProviderId = 'openart') => {
  hooks.cursor = 0; return useGenAiProviders(service, { createProviderId, editProviderId }, report);
};

describe('useGenAiProviders service lifetime', () => {
  it('keeps ordinary preference/reporter rerenders on the same subscription and captures reporter per request', async () => {
    const f = serviceFixture(), firstReport = vi.fn(), nextReport = vi.fn();
    const first = render(f.service, firstReport); commit();
    render(f.service, nextReport, 'higgsfield', 'lighttable-local'); commit();
    const current = render(f.service, nextReport, 'higgsfield', 'lighttable-local');
    expect(current.connectSelected).toBe(first.connectSelected);
    expect(current).toMatchObject({ selectedProviderId: 'higgsfield', editProviderId: 'lighttable-local' });
    expect(f.service.subscribe).toHaveBeenCalledOnce(); expect(f.service.getProviderSnapshots).toHaveBeenCalledOnce();
    const pending = current.connectSelected(); render(f.service, firstReport, 'higgsfield', 'lighttable-local'); commit();
    f.request.reject(new Error('Current error')); await pending;
    expect(nextReport).toHaveBeenCalledExactlyOnceWith('Current error'); expect(firstReport).not.toHaveBeenCalled();
  });
  it('retires the old service before layout cleanup and does not revive it on committed A→B→A', async () => {
    const a = serviceFixture(), b = serviceFixture(), report = vi.fn();
    const original = render(a.service, report); commit(); const pending = original.connectSelected();
    render(b.service, report);
    await original.connectSelected(); expect(a.service.connectProvider).toHaveBeenCalledOnce(); commit();
    render(a.service, report); commit();
    a.request.reject(new Error('Retired A')); await pending;
    expect(report).not.toHaveBeenCalled();
    b.emit(connected); b.initial.resolve([connected]); await Promise.resolve();
    expect(render(a.service, report).provider.status).toBe('disconnected');
  });
  it('retains current event projection, but old event/request callbacks are inert after unmount', async () => {
    const f = serviceFixture(), report = vi.fn(), current = render(f.service, report); commit();
    f.emit(connected); expect(render(f.service, report).provider.status).toBe('connected');
    const pending = current.disconnectOpenArt(); unmount();
    f.emit({ ...connected, status: 'error', message: 'Late event' });
    f.request.reject(new Error('Late disconnect')); await pending; await current.connectSelected();
    expect(report).not.toHaveBeenCalled(); expect(f.service.connectProvider).not.toHaveBeenCalled();
    expect(render(f.service, report).provider.status).toBe('connected');
  });
});
