import { beforeEach, expect, it, vi } from 'vitest';
import { usePenPresentation } from './usePenPresentation';
import type { VectorToolSessionController } from '../../application/vectors/VectorToolSessionController';

const lifecycle = vi.hoisted(() => ({ setup: null as null | (() => () => void) }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useMemo: (create: () => unknown) => create(),
  useLayoutEffect: (setup: () => () => void) => { lifecycle.setup = setup; }
}));
beforeEach(() => { lifecycle.setup = null; });
it('closes retained callbacks on cleanup and rearms the same binding on StrictMode replay', () => {
  const controller = { finishPenPath: vi.fn(() => true), cancelPenPath: vi.fn(() => true),
    undoPenAnchor: vi.fn(() => true), penEditingOverlay: vi.fn(() => null) };
  const renderer = { setPenEditingOverlay: vi.fn(), setPenRubberBandOverlay: vi.fn() };
  const binding = usePenPresentation(controller as unknown as VectorToolSessionController,
    renderer, {}, 1, {}, () => ({ isCurrent: () => true }));
  expect(binding.finish()).toBe(false);
  const cleanup = lifecycle.setup!();
  expect(binding.finish()).toBe(true);
  cleanup();
  renderer.setPenEditingOverlay.mockClear(); renderer.setPenRubberBandOverlay.mockClear();
  expect(binding.finish()).toBe(false); binding.setOverlay(null); binding.setRubberBand(null);
  expect(controller.finishPenPath).toHaveBeenCalledOnce();
  expect(renderer.setPenEditingOverlay).not.toHaveBeenCalled();
  expect(renderer.setPenRubberBandOverlay).not.toHaveBeenCalled();
  const cleanupReplay = lifecycle.setup!();
  expect(binding.finish()).toBe(true);
  expect(controller.finishPenPath).toHaveBeenCalledTimes(2);
  cleanupReplay();
});
