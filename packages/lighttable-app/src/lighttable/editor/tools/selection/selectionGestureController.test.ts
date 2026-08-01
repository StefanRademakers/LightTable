import { describe, expect, it } from 'vitest';
import { SelectionGestureController } from './selectionGestureController';

describe('SelectionGestureController', () => {
  it('owns a rectangle gesture from begin through finish', () => {
    const controller = new SelectionGestureController();
    expect(controller.begin(7, 'select-rectangle', { x: 10, y: 20 }, 'add')).toEqual({
      kind: 'rectangle',
      points: [{ x: 10, y: 20 }, { x: 10, y: 20 }]
    });
    expect(controller.move(7, { x: 40, y: 50 })).toEqual({
      kind: 'rectangle',
      points: [{ x: 10, y: 20 }, { x: 40, y: 50 }]
    });
    expect(controller.finish(7)).toEqual({
      kind: 'apply',
      mode: 'add',
      shape: {
        kind: 'rectangle',
        points: [{ x: 10, y: 20 }, { x: 40, y: 50 }]
      }
    });
    expect(controller.pointerId).toBeNull();
    expect(controller.draft).toBeNull();
  });

  it('samples free selections only after meaningful pointer movement', () => {
    const controller = new SelectionGestureController();
    controller.begin(2, 'select-free', { x: 0, y: 0 }, 'replace');
    expect(controller.move(2, { x: 1, y: 1 })).toBeNull();
    expect(controller.move(2, { x: 2, y: 0 })).toEqual({
      kind: 'free',
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }]
    });
  });

  it('clears on an invalid unmodified gesture but preserves on modified gestures', () => {
    const controller = new SelectionGestureController();
    controller.begin(3, 'select-ellipse', { x: 1, y: 1 }, 'replace');
    expect(controller.finish(3)).toEqual({
      kind: 'clear'
    });
    controller.begin(4, 'select-ellipse', { x: 1, y: 1 }, 'add');
    expect(controller.finish(4)).toEqual({
      kind: 'none'
    });
  });

  it('ignores foreign pointers and supports explicit cancellation', () => {
    const controller = new SelectionGestureController();
    controller.begin(11, 'select-rectangle', { x: 0, y: 0 }, 'replace');
    expect(controller.move(12, { x: 10, y: 10 })).toBeNull();
    expect(controller.finish(12)).toBeNull();
    expect(controller.cancel(12)).toBe(false);
    expect(controller.cancel(11)).toBe(true);
    expect(controller.pointerId).toBeNull();
  });

  it('does not leak mutable draft objects to callers', () => {
    const controller = new SelectionGestureController();
    const draft = controller.begin(1, 'select-rectangle', { x: 4, y: 5 }, 'replace');
    draft.points[0].x = 999;
    expect(controller.draft?.points[0]).toEqual({ x: 4, y: 5 });
  });
});
