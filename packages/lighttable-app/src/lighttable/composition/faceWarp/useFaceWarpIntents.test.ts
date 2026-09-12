import { beforeEach, expect, it, vi } from 'vitest';
import type { FaceWarpInteractionSessionController } from '../../application/tools/faceWarp/FaceWarpInteractionSessionController';
import type { FaceWarpDetectionReviewController } from '../../application/tools/faceWarp/FaceWarpDetectionReviewController';
import { useFaceWarpIntents } from './useFaceWarpIntents';

const lifecycle = vi.hoisted(() => ({ setup: null as null | (() => () => void),
  ref: null as null | { current: unknown },
  memo: null as null | { dependencies: readonly unknown[]; value: unknown } }));
// Preserve memo/ref identity between simulated renders; an always-recreating mock
// would conceal the real null-renderer -> ready transition caught by the package.
vi.mock('react', () => ({ useRef: (current: unknown) => lifecycle.ref ??= { current },
  useMemo: (create: () => unknown, dependencies: readonly unknown[]) => {
    if (!lifecycle.memo || dependencies.some((value, index) => value !== lifecycle.memo!.dependencies[index])) {
      lifecycle.memo = { dependencies, value: create() };
    }
    return lifecycle.memo.value;
  },
  useLayoutEffect: (setup: () => () => void) => { lifecycle.setup = setup; } }));
beforeEach(() => { lifecycle.setup = null; lifecycle.ref = null; lifecycle.memo = null; });

it('rebinds null-to-ready renderer at unchanged generation without rebuilding on ordinary renders', () => {
  let renderer: object | null = null;
  const controller = {} as FaceWarpInteractionSessionController;
  const review = { getSnapshot: () => ({ busy: false, pending: null,
    selectedFaceId: null, meshVisible: false }), cancel: vi.fn() };
  const session = {}; const runtime = {};
  const capture = () => {
    const openingRenderer = renderer;
    return { isCurrent: () => renderer === openingRenderer };
  };
  const render = () => useFaceWarpIntents(controller,
    review as unknown as FaceWarpDetectionReviewController, session, renderer, 1, runtime,
    capture, () => ({ document: null, brush: { size: 100, opacity: 1 }, target: 'both' }), vi.fn());
  const starting = render(); const cleanup = lifecycle.setup!();
  renderer = {};
  const ready = render();
  expect(ready).not.toBe(starting);
  cleanup(); lifecycle.setup!();
  starting.cancelReview(); expect(review.cancel).not.toHaveBeenCalled();
  ready.cancelReview(); expect(review.cancel).toHaveBeenCalledOnce();
  expect(render()).toBe(ready);
});

it('retires retained callbacks without cancelling successor state and rearms StrictMode setup', () => {
  let current = true;
  const controller = { finishGesture: vi.fn(() => true), cancelGesture: vi.fn(() => true) };
  const review = { getSnapshot: () => ({ busy: false, pending: null,
    selectedFaceId: null, meshVisible: false }), cancel: vi.fn() };
  const binding = useFaceWarpIntents(controller as unknown as FaceWarpInteractionSessionController,
    review as unknown as FaceWarpDetectionReviewController, {}, {}, 1, {},
    () => ({ isCurrent: () => current }), () => ({ document: null,
      brush: { size: 100, opacity: 0.5 }, target: 'both' }), vi.fn());
  expect(binding.gesture.finish(1)).toBe(false);
  const cleanup = lifecycle.setup!();
  expect(binding.gesture.finish(1)).toBe(true);
  binding.cancelReview(); expect(review.cancel).toHaveBeenCalledOnce();
  cleanup();
  expect(binding.gesture.cancel(1)).toBe(false);
  binding.cancelReview(); expect(review.cancel).toHaveBeenCalledOnce();
  lifecycle.setup!(); expect(binding.gesture.cancel(1)).toBe(true);
  current = false;
  expect(binding.gesture.finish(1)).toBe(false);
  binding.cancelReview();
  expect(controller.finishGesture).toHaveBeenCalledOnce();
  expect(review.cancel).toHaveBeenCalledOnce();
});
