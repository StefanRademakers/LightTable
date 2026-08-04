import { describe, expect, it, vi } from 'vitest';
import { SelectionAntsAnimator } from './SelectionAntsAnimator';

describe('SelectionAntsAnimator', () => {
  it('submits at most one viewport-only phase update every 500 ms', () => {
    vi.useFakeTimers();
    const invalidateViewport = vi.fn();
    const requestRender = vi.fn();
    const animator = new SelectionAntsAnimator({ invalidateViewport, requestRender });

    animator.setSelectionVisible(true);
    vi.advanceTimersByTime(499);
    expect(requestRender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(animator.phasePx).toBe(4);
    expect(invalidateViewport).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(animator.phasePx).toBe(12);
    expect(requestRender).toHaveBeenCalledTimes(3);

    animator.dispose();
    vi.useRealTimers();
  });

  it('owns no timer while inactive or without a visible selection', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const animator = new SelectionAntsAnimator({
      invalidateViewport: vi.fn(),
      requestRender
    });

    animator.setActive(false);
    animator.setSelectionVisible(true);
    vi.advanceTimersByTime(2_000);
    expect(requestRender).not.toHaveBeenCalled();
    animator.setActive(true);
    vi.advanceTimersByTime(500);
    expect(requestRender).toHaveBeenCalledOnce();
    animator.setSelectionVisible(false);
    expect(animator.phasePx).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(requestRender).toHaveBeenCalledOnce();

    animator.dispose();
    vi.useRealTimers();
  });
});
