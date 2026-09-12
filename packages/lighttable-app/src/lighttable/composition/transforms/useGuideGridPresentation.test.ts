import { beforeEach, expect, it, vi } from 'vitest';
import { useGuideGridPresentation } from './useGuideGridPresentation';
import type { GuideGridPresentationInputs } from '../../application/tools/snapping/GuideGridPresentationBinding';

const hooks = vi.hoisted(() => ({ cursor: 0, refs: [] as unknown[], effects: [] as Array<{
  setup(): void | (() => void); dependencies: readonly unknown[];
}> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => hooks.refs[hooks.cursor++] ??= { current },
  useLayoutEffect: (setup: () => void | (() => void), dependencies: readonly unknown[]) => {
    hooks.effects.push({ setup, dependencies });
  }
}));
beforeEach(() => { hooks.cursor = 0; hooks.refs = []; hooks.effects = []; });
const input: GuideGridPresentationInputs = { document: { width: 100, height: 80, guides: [] },
  guidesVisible: true, gridVisible: true, gridSpacing: 10, gridOriginX: 0, gridOriginY: 0, zoom: 1 };
it('captures scope at layout binding, not provisional render; cleanup and replay own one subscription', () => {
  const renderer = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  const listeners = new Set<() => void>();
  const source = { getSnapshot: () => null, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
  const capture = vi.fn(() => ({ isCurrent: () => true }));
  useGuideGridPresentation(renderer, {}, 1, {}, capture, source, () => input, () => renderer);
  expect(capture).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  const cleanup = hooks.effects[0].setup() as () => void;
  expect(capture).toHaveBeenCalledOnce(); expect(listeners.size).toBe(1);
  hooks.effects[1].setup(); expect(renderer.setDocumentGridEditingFrame).toHaveBeenCalledOnce();
  cleanup(); expect(listeners.size).toBe(0);
  hooks.effects[0].setup(); expect(listeners.size).toBe(1);
});
it('lists narrow frame dependencies, never the broad document or snapshot object', () => {
  const renderer = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  const session = {}, lifecycle = {}, source = { getSnapshot: () => null, subscribe: () => () => {} };
  useGuideGridPresentation(renderer, session, 4, lifecycle, () => ({ isCurrent: () => true }), source, () => input, () => renderer);
  expect(hooks.effects[1].dependencies).toEqual([renderer, session, 4, lifecycle,
    input.document!.guides, 100, 80, true, true, 10, 0, 0, 1]);
  expect(hooks.effects[1].dependencies).not.toContain(input.document);
});
it('retired source callbacks cannot write between successor render and layout cleanup', () => {
  const renderer = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  let listener = () => {};
  const source = { getSnapshot: () => [], subscribe: (next: () => void) => { listener = next; return () => {}; } };
  const capture = () => ({ isCurrent: () => true });
  useGuideGridPresentation(renderer, {}, 1, {}, capture, source, () => input, () => renderer);
  hooks.effects[0].setup(); renderer.setDocumentGuideEditingFrame.mockClear();
  hooks.cursor = 0; hooks.effects = [];
  useGuideGridPresentation(renderer, {}, 2, {}, capture, source, () => input, () => renderer);
  listener(); expect(renderer.setDocumentGuideEditingFrame).not.toHaveBeenCalled();
});
it('rejects a render-time renderer that was replaced before layout scope capture', () => {
  const renderer = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  let live = renderer;
  const subscribe = vi.fn(() => () => {});
  useGuideGridPresentation(renderer, {}, 1, {}, () => ({ isCurrent: () => true }),
    { getSnapshot: () => null, subscribe }, () => input, () => live);
  live = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  hooks.effects[0].setup(); hooks.effects[1].setup();
  expect(subscribe).not.toHaveBeenCalled();
  expect(renderer.setDocumentGuideEditingFrame).not.toHaveBeenCalled();
  expect(live.setDocumentGuideEditingFrame).not.toHaveBeenCalled();
});
