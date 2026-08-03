import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../../editor/document/documentTypes';
import { TextSelectionGestureController } from './TextSelectionGestureController';

const layerId = 'paragraph' as LayerId;

const fixture = () => {
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  const publishSelection = vi.fn();
  const cancelFrame = vi.fn((frame: number) => { frames.delete(frame); });
  const controller = new TextSelectionGestureController(() => ({
    focusAt: (_layerId, point) => Math.round(point.x),
    publishSelection,
    requestFrame: (callback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    },
    cancelFrame
  }));
  return { controller, frames, publishSelection, cancelFrame };
};

describe('TextSelectionGestureController', () => {
  it('publishes only the latest pointer focus once per animation frame', () => {
    const state = fixture();
    state.controller.begin(7, layerId, 2);

    expect(state.controller.move(7, { x: 5, y: 0 })).toBe(true);
    expect(state.controller.move(7, { x: 9, y: 0 })).toBe(true);
    expect(state.frames.size).toBe(1);
    expect(state.publishSelection).not.toHaveBeenCalled();

    [...state.frames.values()][0]!();
    expect(state.publishSelection).toHaveBeenCalledOnce();
    expect(state.publishSelection).toHaveBeenCalledWith({ anchor: 2, focus: 9 }, true);
  });

  it('cancels pending preview work and publishes the exact pointer-up range', () => {
    const state = fixture();
    state.controller.begin(3, layerId, 4);
    state.controller.move(3, { x: 8, y: 0 });

    expect(state.controller.finish(3, { x: 12, y: 0 })).toBe(true);
    expect(state.cancelFrame).toHaveBeenCalledOnce();
    expect(state.publishSelection).toHaveBeenCalledOnce();
    expect(state.publishSelection).toHaveBeenCalledWith({ anchor: 4, focus: 12 }, false);
    expect(state.controller.owns(3)).toBe(false);
  });

  it('drops a cancelled gesture without publishing a range', () => {
    const state = fixture();
    state.controller.begin(5, layerId, 1);
    state.controller.move(5, { x: 6, y: 0 });

    expect(state.controller.cancel(5)).toBe(true);
    expect(state.publishSelection).not.toHaveBeenCalled();
    expect(state.frames.size).toBe(0);
  });
});
