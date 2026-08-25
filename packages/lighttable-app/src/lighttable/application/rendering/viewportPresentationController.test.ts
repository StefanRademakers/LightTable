import { describe, expect, it, vi } from 'vitest';
import {
  ViewportPresentationController,
  interpolateViewportRect
} from './viewportPresentationController';

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
  it('interpolates only presentation geometry and clamps animation progress', () => {
    const from = { x: 10, y: 20, width: 400, height: 300 };
    const to = { x: 50, y: 60, width: 800, height: 600 };
    expect(interpolateViewportRect(from, to, 0.5)).toEqual({
      x: 30, y: 40, width: 600, height: 450
    });
    expect(interpolateViewportRect(from, to, -1)).toEqual(from);
    expect(interpolateViewportRect(from, to, 2)).toEqual(to);
  });

  it('publishes changed viewport measurements exactly once', () => {
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
  });

  it('keeps nearest sampling throughout every zoom step above the pixel threshold', () => {
    const harness = createHarness();

    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 500,
      height: 500
    });
    expect(harness.controller.sampling).toBe('nearest');
    expect(harness.invalidateViewport).toHaveBeenCalledOnce();

    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 700,
      height: 700
    });
    expect(harness.controller.sampling).toBe('nearest');
    expect(harness.invalidateViewport).toHaveBeenCalledTimes(2);

    harness.controller.resize(100, 800, 600, 1, {
      x: 0,
      y: 0,
      width: 200,
      height: 200
    });
    expect(harness.controller.sampling).toBe('linear');
    expect(harness.invalidateViewport).toHaveBeenCalledTimes(3);
    harness.controller.dispose();
  });

  it('rejects viewport work after disposal', () => {
    const harness = createHarness();
    const rect = {
      x: 0,
      y: 0,
      width: 500,
      height: 500
    };
    harness.controller.resize(100, 800, 600, 1, rect);
    harness.controller.dispose();
    expect(harness.controller.resize(100, 800, 600, 1, {
      ...rect,
      width: 200,
      height: 200
    })).toBe(false);
    expect(harness.controller.sampling).toBe('nearest');
    expect(harness.invalidateViewport).toHaveBeenCalledOnce();
  });

  it('can republish retained uniforms after GPU resources are recreated', () => {
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
  });
});
