import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentGpuRecovery } from './useDocumentGpuRecovery';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';

interface Effect { setup(): void | (() => void); deps: unknown[]; cleanup?: () => void; changed: boolean }
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Effect[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useLayoutEffect: (setup: Effect['setup'], deps: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as Effect | undefined;
    if (!previous) {
      const effect = { setup, deps, changed: true }; hooks.slots[index] = effect; hooks.effects.push(effect);
    } else {
      previous.changed = deps.some((value, i) => value !== previous.deps[i]); previous.setup = setup; previous.deps = deps;
    }
  }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; vi.useFakeTimers(); });
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); vi.useRealTimers(); });
const flush = () => { for (const effect of hooks.effects) if (effect.changed) {
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
} };
const fixture = () => {
  const lifecycle = new DocumentRendererLifecycle(); lifecycle.beginStart();
  const session = new DocumentSession({ id: 'same' as DocumentSessionId, source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  const options = { session, lifecycle, renderer: { current: {} }, opening: {}, snapshot: lifecycle.getSnapshot(),
    reportError: vi.fn(), requestReopen: vi.fn() };
  const render = () => { hooks.cursor = 0; options.snapshot = options.lifecycle.getSnapshot(); return useDocumentGpuRecovery(options); };
  return { options, render };
};

it('records loss synchronously, replays layout safely, and preserves a stable actual-candidate gate', () => {
  const { options, render } = fixture(); const gate = render(); flush();
  options.lifecycle.markFailed(1, 'WebGPU device lost: test');
  expect(gate(options.renderer.current)).toBe(false);
  const effect = hooks.effects[0]; effect.cleanup?.(); effect.cleanup = effect.setup() || undefined;
  vi.advanceTimersByTime(50); expect(options.requestReopen).toHaveBeenCalledOnce();
  expect(render()).toBe(gate); flush(); vi.advanceTimersByTime(50);
  expect(options.requestReopen).toHaveBeenCalledOnce(); options.session.dispose();
});

it.each(['session', 'lifecycle', 'renderer', 'opening'] as const)('rejects an old timer before layout cleanup after equal-scalar %s replacement', kind => {
  const { options, render } = fixture(); render(); flush();
  options.lifecycle.markFailed(1, 'WebGPU device lost: old');
  if (kind === 'session') options.session = new DocumentSession({ id: 'same' as DocumentSessionId, source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  if (kind === 'lifecycle') { options.lifecycle = new DocumentRendererLifecycle(); options.lifecycle.beginStart(); }
  if (kind === 'renderer') options.renderer.current = {};
  if (kind === 'opening') options.opening = {};
  render(); // Deliberately leave the old layout connection alive.
  vi.advanceTimersByTime(50); expect(options.requestReopen).not.toHaveBeenCalled();
  expect(options.reportError).not.toHaveBeenCalled(); options.session.dispose();
});

it('disposal before React cleanup prevents a retry against the retired session', () => {
  const { options, render } = fixture(); render(); flush();
  options.lifecycle.markFailed(1, 'WebGPU device lost: pending'); options.session.dispose();
  vi.advanceTimersByTime(50); expect(options.requestReopen).not.toHaveBeenCalled();
});
