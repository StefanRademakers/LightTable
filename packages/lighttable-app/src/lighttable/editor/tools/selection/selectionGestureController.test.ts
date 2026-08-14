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
      featherRadius: 0,
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

  it('smooths free selections and still closes on the last raw pointer point', () => {
    const controller = new SelectionGestureController();
    controller.begin(
      5,
      'select-free',
      { x: 0, y: 0 },
      'replace',
      undefined,
      2,
      128
    );
    const draft = controller.move(5, { x: 300, y: 0 });
    expect(draft?.points.at(-1)?.x).toBeLessThan(100);
    const result = controller.finish(5);
    expect(result).toMatchObject({
      kind: 'apply',
      shape: { points: expect.arrayContaining([{ x: 300, y: 0 }]) }
    });
  });

  it('retains an ordered free-selection input batch in one draft update', () => {
    const controller = new SelectionGestureController();
    controller.begin(6, 'select-free', { x: 0, y: 0 }, 'replace');
    expect(controller.moveMany(6, [
      { x: 3, y: 0 },
      { x: 6, y: 1 },
      { x: 9, y: 2 }
    ])).toEqual({
      kind: 'free',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 6, y: 1 },
        { x: 9, y: 2 }
      ]
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

  it('creates and repositions a full-width horizontal strip', () => {
    const controller = new SelectionGestureController();
    const options = { documentWidth: 100, documentHeight: 80, size: 3 };
    expect(controller.begin(
      20,
      'select-horizontal',
      { x: 45, y: 10 },
      'replace',
      options
    )).toEqual({
      kind: 'rectangle',
      points: [{ x: 0, y: 9 }, { x: 100, y: 12 }]
    });
    expect(controller.move(20, { x: 3, y: 79 })).toEqual({
      kind: 'rectangle',
      points: [{ x: 0, y: 77 }, { x: 100, y: 80 }]
    });
  });

  it('creates a document-high vertical strip with a one-pixel default', () => {
    const controller = new SelectionGestureController();
    expect(controller.begin(
      21,
      'select-vertical',
      { x: 12.8, y: 40 },
      'add',
      { documentWidth: 100, documentHeight: 80, size: 1 }
    )).toEqual({
      kind: 'rectangle',
      points: [{ x: 12, y: 0 }, { x: 13, y: 80 }]
    });
    expect(controller.finish(21)).toEqual(expect.objectContaining({ kind: 'apply', mode: 'add' }));
  });

  it('captures ratio geometry and feather for one rectangle gesture', () => {
    const controller = new SelectionGestureController();
    controller.begin(
      22,
      'select-rectangle',
      { x: 10, y: 10 },
      'replace',
      undefined,
      0,
      48,
      { style: 'ratio', width: 16, height: 9, featherRadius: 12 }
    );
    expect(controller.move(22, { x: 42, y: 20 })).toEqual({
      kind: 'rectangle',
      points: [{ x: 10, y: 10 }, { x: 42, y: 28 }]
    });
    expect(controller.finish(22)).toMatchObject({
      kind: 'apply',
      featherRadius: 12
    });
  });

  it('creates fixed-size ellipse geometry in the pointer direction', () => {
    const controller = new SelectionGestureController();
    expect(controller.begin(
      23,
      'select-ellipse',
      { x: 50, y: 50 },
      'replace',
      undefined,
      0,
      48,
      { style: 'fixed', width: 20, height: 12, featherRadius: 0 }
    )).toEqual({
      kind: 'ellipse',
      points: [{ x: 50, y: 50 }, { x: 70, y: 62 }]
    });
    expect(controller.move(23, { x: 40, y: 30 })).toEqual({
      kind: 'ellipse',
      points: [{ x: 50, y: 50 }, { x: 30, y: 38 }]
    });
  });
});
