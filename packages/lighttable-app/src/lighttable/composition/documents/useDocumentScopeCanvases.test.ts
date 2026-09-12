import { beforeEach, expect, it, vi } from 'vitest';
import { useDocumentScopeCanvases } from './useDocumentScopeCanvases';
import type { DocumentRendererScopeCanvases } from '../../application/rendering/rendererTypes';

interface Effect { setup(): void | (() => void); deps: unknown[]; cleanup?: () => void; changed: boolean }
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Effect[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.cursor++, prior = hooks.slots[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (!prior || deps.some((value, i) => value !== prior.deps[i])) hooks.slots[index] = { callback, deps };
    return (hooks.slots[index] as { callback: unknown }).callback;
  },
  useLayoutEffect: (setup: Effect['setup'], deps: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as Effect | undefined;
    if (!previous) {
      const effect = { setup, deps, changed: true }; hooks.slots[index] = effect; hooks.effects.push(effect);
    } else {
      previous.changed = deps.some((value, i) => value !== previous.deps[i]); previous.setup = setup; previous.deps = deps;
    }
  }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
const flush = () => { for (const effect of hooks.effects) if (effect.changed) {
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
} };
const fixture = () => {
  const ref = () => ({ current: {} as HTMLCanvasElement | null });
  const renderer = { current: { initializeScopes: vi.fn(async (_canvases: DocumentRendererScopeCanvases) => {}) } };
  const scope = { isCurrent: vi.fn(() => true) };
  const options = { renderer, canvases: { viewport: ref(), hueDistribution: ref(), colorMixerHueDistribution: ref(), parade: ref(), vectorscope: ref() },
    ready: true, generation: 1, lifecycle: {}, surfaceRevision: 0, captureScope: () => scope, reportError: vi.fn() };
  const render = () => { hooks.cursor = 0; return useDocumentScopeCanvases(options); };
  return { options, scope, render };
};

it('binds resolved required canvases and attaches/detaches Color Mixer through the same request path', async () => {
  const { options, render } = fixture(), callback = render(); flush();
  const initialize = options.renderer.current.initializeScopes;
  expect(initialize).toHaveBeenCalledOnce();
  callback(null);
  expect(initialize.mock.calls.at(-1)?.[0]).not.toHaveProperty('colorMixerHueDistribution');
  const canvas = {} as HTMLCanvasElement; callback(canvas);
  expect(initialize.mock.calls.at(-1)?.[0]).toMatchObject({ colorMixerHueDistribution: canvas });
  expect(render()).toBe(callback); flush(); expect(initialize).toHaveBeenCalledTimes(3);
});

it('rebinds complete remounts in layout and survives StrictMode cleanup/setup replay', () => {
  const { options, render } = fixture(); render(); flush();
  options.canvases.parade.current = {} as HTMLCanvasElement; options.surfaceRevision += 1;
  render(); flush();
  expect(options.renderer.current.initializeScopes.mock.calls.at(-1)?.[0]).toMatchObject({ parade: options.canvases.parade.current });
  const effect = hooks.effects[0]; effect.cleanup?.(); effect.cleanup = effect.setup() || undefined;
  expect(options.renderer.current.initializeScopes).toHaveBeenCalledTimes(3);
});

it('reports current optional attachment errors and ignores retired renderer/scope completions', async () => {
  const { options, scope, render } = fixture();
  let reject!: (reason: Error) => void;
  options.renderer.current.initializeScopes.mockImplementation(() => new Promise((_resolve, no) => { reject = no; }));
  const callback = render(); flush();
  scope.isCurrent.mockReturnValue(false); reject(new Error('retired renderer')); await Promise.resolve();
  expect(options.reportError).not.toHaveBeenCalled();
  scope.isCurrent.mockReturnValue(true); callback({} as HTMLCanvasElement);
  reject(new Error('current canvas')); await Promise.resolve();
  expect(options.reportError).toHaveBeenCalledWith('current canvas');
  callback(null); hooks.effects[0].cleanup?.(); reject(new Error('unmounted')); await Promise.resolve();
  expect(options.reportError).toHaveBeenCalledOnce();
});

it('does not initialize absent canvases or an already retired scope', () => {
  const { options, scope, render } = fixture(); options.canvases.parade.current = null;
  const callback = render(); flush(); expect(options.renderer.current.initializeScopes).not.toHaveBeenCalled();
  options.canvases.parade.current = {} as HTMLCanvasElement; scope.isCurrent.mockReturnValue(false);
  callback({} as HTMLCanvasElement); expect(options.renderer.current.initializeScopes).not.toHaveBeenCalled();
});
