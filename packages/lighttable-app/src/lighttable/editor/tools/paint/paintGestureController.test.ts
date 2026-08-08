import { describe, expect, it } from 'vitest';
import type { LayerId } from '../../document/documentTypes';
import { identityMatrix } from '../transform/affine';
import { PaintGestureController, type PaintGestureTarget } from './paintGestureController';

const target = (patch: Partial<PaintGestureTarget> = {}): PaintGestureTarget => ({
  layerId: 'layer-1' as LayerId,
  channel: 'mask',
  erase: false,
  sourceToDocument: identityMatrix(),
  ...patch
});

describe('PaintGestureController', () => {
  it('locks one target and transform for the complete gesture', () => {
    const controller = new PaintGestureController();
    const source = target({
      sourceToDocument: { a: 0, b: 1, c: -1, d: 0, tx: 30, ty: 40 }
    });
    const first = controller.begin(4, source, { size: 10, spacing: 0.5, smooth: 0 }, {
      x: 20,
      y: 30,
      pressure: 1
    });
    source.channel = 'pixels';
    source.sourceToDocument.tx = 999;
    const next = controller.move(4, { x: 30, y: 30, pressure: 1 });
    expect(first.target.channel).toBe('mask');
    expect(next?.target.channel).toBe('mask');
    expect(next?.target.sourceToDocument.tx).toBe(30);
  });

  it('accumulates dirty bounds and returns them exactly once', () => {
    const controller = new PaintGestureController();
    controller.begin(8, target(), { size: 10, spacing: 1, smooth: 0, maximumSpacingPx: 10 }, {
      x: 10,
      y: 10,
      pressure: 1
    });
    controller.move(8, { x: 30, y: 10, pressure: 1 });
    expect(controller.finish(8)?.dirtyBounds).toEqual({
      x: 5,
      y: 5,
      width: 30,
      height: 10
    });
    expect(controller.finish(8)).toBeNull();
  });

  it('ignores foreign pointers without losing the active gesture', () => {
    const controller = new PaintGestureController();
    controller.begin(2, target(), { size: 4, spacing: 0.5, smooth: 0 }, {
      x: 0,
      y: 0,
      pressure: 1
    });
    expect(controller.move(3, { x: 10, y: 10, pressure: 1 })).toBeNull();
    expect(controller.cancel(3)).toBeNull();
    expect(controller.owns(2)).toBe(true);
    expect(controller.cancel(2)?.target.layerId).toBe('layer-1');
    expect(controller.active).toBe(false);
  });
});
