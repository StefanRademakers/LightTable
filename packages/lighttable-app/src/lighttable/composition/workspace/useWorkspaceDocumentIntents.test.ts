import { beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceDocumentIntents } from './useWorkspaceDocumentIntents';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as (() => void | (() => void)) | null }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
it('owns unmount retirement and StrictMode reconnect while retaining fresh host callbacks', () => {
  const first = vi.fn(), second = vi.fn();
  const ports = { getActiveDocumentId: () => 'A', getSession: () => null,
    captureScope: () => ({ isCurrent: () => true }),
    text: { finishBeforeTransition: (next: () => void) => { next(); return true; } },
    activateDocument: first, closeEditor: vi.fn(), reportFailure: vi.fn() };
  const render = () => { hooks.cursor = 0; return useWorkspaceDocumentIntents(ports); };
  const owner = render(); owner.activate('B'); expect(first).not.toHaveBeenCalled();
  const cleanup = hooks.setup!(); owner.activate('B'); expect(first).toHaveBeenCalledOnce();
  if (cleanup) cleanup(); owner.activate('B'); expect(first).toHaveBeenCalledOnce();
  ports.activateDocument = second; expect(render()).toBe(owner); hooks.setup!(); owner.activate('C');
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledWith('C');
});
