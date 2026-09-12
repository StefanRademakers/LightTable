import { beforeEach, expect, it, vi } from 'vitest';
import { usePropertiesInspectorPresentation } from './usePropertiesInspectorPresentation';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void | (() => void))[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { value: unknown; deps: unknown[] } | undefined;
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) hooks.slots[index] = { value: factory(), deps };
    return (hooks.slots[index] as { value: unknown }).value;
  },
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.effects.push(setup); },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
it('rejects old session callbacks before layout cleanup and pins deferred workspace reveal', () => {
  const reveal = vi.fn(), frames: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let session: object = {}, workspace: object = {};
  const render = () => {
    hooks.cursor = 0; hooks.effects = [];
    return usePropertiesInspectorPresentation(session, null, 1, null, () => {
      const captured = workspace;
      return { isCurrent: () => captured === workspace, reveal };
    });
  };
  const first = render(); const cleanup = hooks.effects[0]!();
  first.show({ kind: 'document-processing', owner: 'grade' }); workspace = {};
  frames[0]!(); expect(reveal).not.toHaveBeenCalled();
  session = {}; const second = render(); first.show({ kind: 'none' });
  expect(frames).toHaveLength(1); if (cleanup) cleanup();
  hooks.effects[0]!(); second.show({ kind: 'document-processing', owner: 'lens-fx' });
  frames[1]!(); expect(reveal).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
