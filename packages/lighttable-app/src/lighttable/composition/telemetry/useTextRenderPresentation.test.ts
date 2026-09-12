import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInitialTextRenderPresentation } from '../../application/telemetry/TextRenderPresentation';
import { useTextRenderPresentation, useTextRenderPresentationDiagnostics } from './useTextRenderPresentation';

// Stateful hook/effect scheduling fixture; this is not React DOM integration proof.
const hooks = vi.hoisted(() => ({
  owner: undefined as unknown, setup: null as null | (() => void | (() => void))
}));
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => hooks.owner ??= factory(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; }
}));
beforeEach(() => { hooks.owner = undefined; hooks.setup = null; });
afterEach(() => vi.unstubAllGlobals());

it('can initialize before diagnostics, then opens admission only at the late layout binding', () => {
  const callbacks: (() => void)[] = [];
  const request = vi.fn((callback: () => void) => callbacks.push(callback));
  const cancel = vi.fn();
  vi.stubGlobal('window', { requestAnimationFrame: request, cancelAnimationFrame: cancel });
  const first = useTextRenderPresentation();
  expect(first.snapshot).toEqual(createInitialTextRenderPresentation());
  const trace = vi.fn();
  const value = { ...first.snapshot, publicationRevision: 5, traceMessage: 'ready' };
  first.owner.receive(value, () => true);
  expect(request).not.toHaveBeenCalled();
  useTextRenderPresentationDiagnostics(first.owner, trace);
  const cleanup = hooks.setup!();
  first.owner.receive(value, () => true); callbacks[0]!();
  const rendered = useTextRenderPresentation();
  expect(rendered.owner).toBe(first.owner);
  expect(rendered.snapshot).toBe(value);
  expect(trace).toHaveBeenCalledOnce();

  first.owner.receive({ ...value, publicationRevision: 6 }, () => true);
  const retiredFrame = callbacks[1]!;
  if (cleanup) cleanup();
  expect(cancel).toHaveBeenCalledWith(2);
  first.owner.receive(value, () => true);
  expect(request).toHaveBeenCalledTimes(2);
  hooks.setup!(); // StrictMode layout replay reopens the same owner.
  first.owner.receive({ ...value, publicationRevision: 7, traceMessage: 'replayed' }, () => true);
  retiredFrame(); callbacks[2]!();
  expect(first.owner.getSnapshot().publicationRevision).toBe(7);
  expect(trace).toHaveBeenLastCalledWith('info', 'GPU text pipeline', 'replayed', undefined);
});
