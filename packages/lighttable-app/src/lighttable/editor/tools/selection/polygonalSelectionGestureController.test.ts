import { describe, expect, it } from 'vitest';
import { PolygonalSelectionGestureController } from './polygonalSelectionGestureController';

const replace = 'replace' as const;

describe('PolygonalSelectionGestureController', () => {
  it('adds straight-line vertices and exposes a moving preview endpoint', () => {
    const controller = new PolygonalSelectionGestureController();
    expect(controller.click({ x: 10, y: 10 }, replace, 4)).toMatchObject({
      kind: 'draft',
      shape: {
        kind: 'polygon',
        points: [{ x: 10, y: 10 }, { x: 10, y: 10 }]
      }
    });
    expect(controller.move({ x: 30, y: 20 })).toEqual({
      kind: 'polygon',
      points: [{ x: 10, y: 10 }, { x: 30, y: 20 }]
    });
    expect(controller.click({ x: 30, y: 20 }, replace, 4)).toMatchObject({
      kind: 'draft',
      shape: {
        points: [{ x: 10, y: 10 }, { x: 30, y: 20 }, { x: 30, y: 20 }]
      }
    });
  });

  it('closes when clicking near the first point and keeps the initial mode', () => {
    const controller = new PolygonalSelectionGestureController();
    controller.click({ x: 10, y: 10 }, 'add', 5);
    controller.click({ x: 40, y: 10 }, replace, 5);
    controller.click({ x: 40, y: 40 }, replace, 5);
    expect(controller.click({ x: 12, y: 12 }, replace, 5)).toEqual({
      kind: 'finish',
      result: {
        kind: 'apply',
        mode: 'add',
        shape: {
          kind: 'polygon',
          points: [
            { x: 10, y: 10 },
            { x: 40, y: 10 },
            { x: 40, y: 40 }
          ]
        }
      }
    });
    expect(controller.active).toBe(false);
  });

  it('supports double-click style forced closure and cancellation', () => {
    const controller = new PolygonalSelectionGestureController();
    controller.click({ x: 0, y: 0 }, replace, 4);
    controller.click({ x: 20, y: 0 }, replace, 4);
    controller.click({ x: 20, y: 20 }, replace, 4);
    expect(controller.click({ x: 20, y: 20 }, replace, 4, true).kind).toBe('finish');

    controller.click({ x: 1, y: 1 }, replace, 4);
    expect(controller.cancel()).toBe(true);
    expect(controller.draft).toBeNull();
  });

  it('closes on two quick nearby clicks even when the browser does not report a double-click', () => {
    const controller = new PolygonalSelectionGestureController();
    controller.click({ x: 0, y: 0 }, replace, 4, false, 0);
    controller.click({ x: 20, y: 0 }, replace, 4, false, 100);
    controller.click({ x: 20, y: 20 }, replace, 4, false, 700);

    expect(controller.click(
      { x: 22, y: 19 },
      replace,
      4,
      false,
      1080
    ).kind).toBe('finish');
  });

  it('does not close for a slow or spatially separate repeat click', () => {
    const controller = new PolygonalSelectionGestureController();
    controller.click({ x: 0, y: 0 }, replace, 4, false, 0);
    controller.click({ x: 20, y: 0 }, replace, 4, false, 100);
    controller.click({ x: 20, y: 20 }, replace, 4, false, 700);

    expect(controller.click(
      { x: 22, y: 19 },
      replace,
      4,
      false,
      1300
    ).kind).toBe('draft');
    expect(controller.click(
      { x: 40, y: 40 },
      replace,
      4,
      false,
      1400
    ).kind).toBe('draft');
  });
});
