import { describe, expect, it, vi } from 'vitest';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import type { WarpSessionController } from '../../application/tools/warp/warpSessionController';
import { routeFreehandPointerMove } from './routeFreehandPointerMove';

const sample = (x: number, timeStamp: number) => ({
  clientX: x,
  clientY: 0,
  pressure: 0.5,
  pointerId: 7,
  pointerType: 'mouse',
  tiltX: x,
  tiltY: -x,
  timeStamp
});

const controllers = () => ({
  selection: {
    move: vi.fn(() => true),
    moveMany: vi.fn(() => true)
  } as unknown as SelectionSessionController,
  warp: {
    moveMany: vi.fn(() => true)
  } as unknown as WarpSessionController,
  paint: {
    move: vi.fn(() => true)
  } as unknown as PaintSessionController
});

describe('freehand pointer move routing', () => {
  it('sends one ordered batch to Warp with tablet metadata intact', () => {
    const ports = controllers();
    const samples = [sample(1, 10), sample(2, 11), sample(3, 12)];
    expect(routeFreehandPointerMove({
      intent: 'warp', activeTool: 'warp', pointerId: 7,
      currentPoint: { x: 3, y: 0, pressure: 0.5 }, samples,
      project: (input) => ({ x: input.clientX, y: input.clientY, pressure: input.pressure }),
      ...ports
    })).toBe(true);
    expect(ports.warp.moveMany).toHaveBeenCalledOnce();
    expect(ports.warp.moveMany).toHaveBeenCalledWith(7, [
      expect.objectContaining({ x: 1, tiltX: 1, timeMs: 10 }),
      expect.objectContaining({ x: 2, tiltX: 2, timeMs: 11 }),
      expect.objectContaining({ x: 3, tiltX: 3, timeMs: 12 })
    ]);
  });

  it('batches free selection but retains per-sample raster paint delivery', () => {
    const ports = controllers();
    const samples = [sample(1, 10), sample(2, 11)];
    const base = {
      pointerId: 7,
      currentPoint: { x: 2, y: 0, pressure: 0.5 },
      samples,
      project: (input: typeof samples[number]) => ({
        x: input.clientX, y: input.clientY, pressure: input.pressure
      }),
      ...ports
    };
    expect(routeFreehandPointerMove({
      ...base, intent: 'selection', activeTool: 'select-free'
    })).toBe(true);
    expect(ports.selection.moveMany).toHaveBeenCalledOnce();

    expect(routeFreehandPointerMove({
      ...base, intent: 'paint', activeTool: 'brush'
    })).toBe(true);
    expect(ports.paint.move).toHaveBeenCalledTimes(2);
  });
});
