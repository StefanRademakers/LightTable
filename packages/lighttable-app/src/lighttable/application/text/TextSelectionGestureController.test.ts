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
    rangeAt: (_layerId, offset, granularity) => granularity === 'word'
      ? { anchor: Math.floor(offset / 10) * 10, focus: Math.floor(offset / 10) * 10 + 10 }
      : { anchor: offset, focus: offset },
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
    state.controller.begin(7, layerId, { anchor: 2, focus: 2 });

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
    state.controller.begin(3, layerId, { anchor: 4, focus: 4 });
    state.controller.move(3, { x: 8, y: 0 });

    expect(state.controller.finish(3, { x: 12, y: 0 })).toBe(true);
    expect(state.cancelFrame).toHaveBeenCalledOnce();
    expect(state.publishSelection).toHaveBeenCalledOnce();
    expect(state.publishSelection).toHaveBeenCalledWith({ anchor: 4, focus: 12 }, false);
    expect(state.controller.owns(3)).toBe(false);
  });

  it('drops a cancelled gesture without publishing a range', () => {
    const state = fixture();
    state.controller.begin(5, layerId, { anchor: 1, focus: 1 });
    state.controller.move(5, { x: 6, y: 0 });

    expect(state.controller.cancel(5)).toBe(true);
    expect(state.publishSelection).not.toHaveBeenCalled();
    expect(state.frames.size).toBe(0);
  });

  it('extends a double-click drag by complete words in either direction', () => {
    const state = fixture();
    state.controller.begin(9, layerId, { anchor: 10, focus: 20 }, 'word');
    state.controller.move(9, { x: 34, y: 0 });
    [...state.frames.values()][0]!();
    expect(state.publishSelection).toHaveBeenLastCalledWith({ anchor: 10, focus: 40 }, true);

    state.controller.move(9, { x: 4, y: 0 });
    [...state.frames.values()][0]!();
    expect(state.publishSelection).toHaveBeenLastCalledWith({ anchor: 20, focus: 0 }, true);
  });
});
