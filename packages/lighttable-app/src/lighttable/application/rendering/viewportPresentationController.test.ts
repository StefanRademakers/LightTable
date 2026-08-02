import { describe, expect, it, vi } from 'vitest';
import { ViewportPresentationController } from './viewportPresentationController';

const createHarness = () => {
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  const writeViewport = vi.fn();
  const invalidateViewport = vi.fn();
  const requestRender = vi.fn();
  const controller = new ViewportPresentationController(
    canvas,
    { writeViewport, invalidateViewport, requestRender }
  );
  return { canvas, controller, writeViewport, invalidateViewport, requestRender };
};

describe('ViewportPresentationController', () => {
  it('publishes changed viewport measurements exactly once', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const rect = { x: 10, y: 20, width: 800, height: 450 };

    expect(harness.controller.resize(1600, 1000, 700, 2, rect)).toBe(true);
    expect(harness.canvas.width).toBe(2000);
    expect(harness.canvas.height).toBe(1400);
    expect(harness.writeViewport).toHaveBeenCalledOnce();
    expect(harness.invalidateViewport).toHaveBeenCalledOnce();
    expect(harness.requestRender).toHaveBeenCalledOnce();

    expect(harness.controller.resize(1600, 1000, 700, 2, rect)).toBe(false);
    expect(harness.writeViewport).toHaveBeenCalledOnce();
    harness.controller.dispose();
    vi.useRealTimers();
  });

  it('uses smooth sampling while zooming and nearest sampling after a high zoom settles', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 500,
      height: 500
    });
    expect(harness.controller.sampling).toBe('linear');
    vi.advanceTimersByTime(75);
    expect(harness.controller.sampling).toBe('nearest');
    expect(harness.invalidateViewport).toHaveBeenCalledTimes(2);

    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 200,
      height: 200
    });
    expect(harness.controller.sampling).toBe('linear');
    vi.advanceTimersByTime(75);
    expect(harness.controller.sampling).toBe('linear');
    harness.controller.dispose();
    vi.useRealTimers();
  });

  it('cancels pending sampling work when disposed', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 500,
      height: 500
    });
    harness.controller.dispose();
    vi.runAllTimers();
    expect(harness.controller.sampling).toBe('linear');
    expect(harness.invalidateViewport).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('can republish retained uniforms after GPU resources are recreated', () => {
    vi.useFakeTimers();
    const harness = createHarness();
    expect(harness.controller.syncCurrentState()).toBe(false);
    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 200,
      height: 200
    });
    harness.writeViewport.mockClear();
    expect(harness.controller.syncCurrentState()).toBe(true);
    expect(harness.writeViewport).toHaveBeenCalledOnce();
    harness.controller.dispose();
    vi.useRealTimers();
  });
});
