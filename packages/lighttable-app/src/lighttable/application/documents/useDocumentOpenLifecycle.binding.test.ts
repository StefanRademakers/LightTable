import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentOpenLifecycle, type DocumentOpenLifecycleContext } from './useDocumentOpenLifecycle';
import { DocumentTaskRegistry } from '../tasks/documentTaskRegistry';
import type { DocumentSessionId } from './documentSession';
import { DocumentRendererLifecycle } from '../rendering/documentRendererLifecycle';
import { TextRenderPresentation, createInitialTextRenderPresentation } from '../telemetry/TextRenderPresentation';

type Effect = { setup: () => void | (() => void); deps: readonly unknown[]; cleanup?: () => void; changed: boolean };
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], layouts: [] as Effect[], passives: [] as Effect[] }));
const runtime = vi.hoisted(() => ({ open: vi.fn().mockResolvedValue(undefined), cancel: vi.fn(), close: vi.fn() }));
vi.mock('./documentOpenController', () => ({
  DocumentOpenController: class { open = runtime.open; cancelOpen = runtime.cancel; close = runtime.close; }
}));
vi.mock('react', () => {
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const effect = (collection: Effect[], setup: Effect['setup'], deps: readonly unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as Effect | undefined;
    const next = previous && same(previous.deps, deps) ? previous
      : { setup, deps, cleanup: previous?.cleanup, changed: true };
    hooks.slots[index] = next; collection.push(next);
  };
  return {
    useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
    useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
      const index = hooks.cursor++, previous = hooks.slots[index] as { value: unknown; deps: readonly unknown[] } | undefined;
      if (!previous || !same(previous.deps, deps)) hooks.slots[index] = { value: factory(), deps };
      return (hooks.slots[index] as { value: unknown }).value;
    },
    useLayoutEffect: (setup: Effect['setup'], deps: readonly unknown[]) => effect(hooks.layouts, setup, deps),
    useEffect: (setup: Effect['setup'], deps: readonly unknown[]) => effect(hooks.passives, setup, deps)
  };
});
const commit = (effects: Effect[]) => {
  for (const effect of effects) if (effect.changed) effect.cleanup?.();
  for (const effect of effects) if (effect.changed) {
    effect.cleanup = effect.setup() || undefined; effect.changed = false;
  }
};
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.layouts = []; hooks.passives = [];
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

const fixture = () => {
  const contexts: DocumentOpenLifecycleContext[] = [];
  const options = {
    enabled: true, generation: {},
    tasks: new DocumentTaskRegistry('A' as DocumentSessionId), rendererLifecycle: new DocumentRendererLifecycle(),
    createRequest: (context: DocumentOpenLifecycleContext) => {
      contexts.push(context);
      return { createRenderer: async () => ({ destroy: vi.fn() }), loadSource: async () => new Blob(), hydrate: async () => undefined };
    },
    beforeOpen: vi.fn(), afterClose: vi.fn(), canReuseRenderer: () => true
  };
  const render = () => {
    hooks.cursor = 0; hooks.layouts = []; hooks.passives = [];
    useDocumentOpenLifecycle(options);
  };
  render(); commit(hooks.layouts); commit(hooks.passives);
  return { options, contexts, render };
};

describe('document-open committed callback lifetime (simulated hook scheduling)', () => {
  it.each(['generation', 'disabled', 'controller'] as const)('retires queued text before passive %s teardown', replacement => {
    const f = fixture(), frames: (() => void)[] = [], trace = vi.fn();
    const presentation = new TextRenderPresentation({ request: callback => frames.push(callback), cancel: vi.fn() });
    presentation.connect(trace);
    const old = f.contexts[0]!;
    presentation.receive({ ...createInitialTextRenderPresentation(), publicationRevision: 8, traceMessage: 'old' }, old.isCurrent);
    if (replacement === 'generation') f.options.generation = {};
    if (replacement === 'disabled') f.options.enabled = false;
    if (replacement === 'controller') f.options.rendererLifecycle = new DocumentRendererLifecycle();
    f.render();
    expect(old.isCurrent()).toBe(true); // An uncommitted render does not retire the live owner.
    commit(hooks.layouts);
    expect(old.isCurrent()).toBe(false);
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(runtime.close).not.toHaveBeenCalled();
    frames[0]!();
    expect(presentation.getSnapshot().publicationRevision).toBe(0);
    expect(trace).not.toHaveBeenCalled();
    commit(hooks.passives);
    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(runtime.open).toHaveBeenCalledTimes(replacement === 'disabled' ? 1 : 2);
  });

  it('preserves ordinary renders and gives StrictMode replay a new guard without reviving old callbacks', () => {
    const f = fixture(), old = f.contexts[0]!;
    f.render(); commit(hooks.layouts); commit(hooks.passives);
    expect(f.contexts).toHaveLength(1);
    expect(old.isCurrent()).toBe(true);
    for (const effect of hooks.layouts) effect.cleanup?.();
    expect(old.isCurrent()).toBe(false);
    for (const effect of hooks.passives) effect.cleanup?.();
    for (const effect of hooks.layouts) effect.cleanup = effect.setup() || undefined;
    for (const effect of hooks.passives) effect.cleanup = effect.setup() || undefined;
    expect(f.contexts).toHaveLength(2);
    expect(f.contexts[1]!.isCurrent()).toBe(true);
    expect(old.isCurrent()).toBe(false);
  });

  it('does not admit an old surface-readiness RAF between layout retirement and passive cleanup', () => {
    const f = fixture(), frames: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback), cancelAnimationFrame: vi.fn() });
    const createRequest = vi.fn(() => null);
    const options = { ...f.options, generation: {}, createRequest };
    hooks.cursor = 0; hooks.layouts = []; hooks.passives = [];
    useDocumentOpenLifecycle(options); commit(hooks.layouts); commit(hooks.passives);
    expect(createRequest).toHaveBeenCalledOnce();
    for (const effect of hooks.layouts) effect.cleanup?.();
    frames[0]!(0);
    expect(createRequest).toHaveBeenCalledOnce();
  });
});
