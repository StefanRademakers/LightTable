import { describe, expect, it } from 'vitest';
import { translationMatrix } from './affine';
import {
  selectionOperationsBounds,
  selectionOperationsSupportBounds,
  transformSelectionOperations
} from './selectionTransform';

describe('LightTable selection transforms', () => {
  it('calculates selection bounds and transforms its outline', () => {
    const operations = [{
      mode: 'replace' as const,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 10, y: 20 }, { x: 30, y: 50 }]
      }
    }];
    expect(selectionOperationsBounds(operations, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 30
    });
    const transformed = transformSelectionOperations(operations, translationMatrix(4, -5));
    expect(transformed[0].shape.kind).toBe('free');
    expect(transformed[0].shape.points[0]).toEqual({ x: 14, y: 15 });
  });

  it('preserves feather operations without letting them expand geometry bounds', () => {
    const operations = [{
      mode: 'replace' as const,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 10, y: 20 }, { x: 30, y: 50 }]
      }
    }, {
      mode: 'feather' as const,
      amount: 8,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }]
      }
    }];
    expect(selectionOperationsBounds(operations, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 10, y: 20, width: 20, height: 30
    });
    const transformed = transformSelectionOperations(operations, translationMatrix(4, -5));
    expect(transformed[1]).toEqual(operations[1]);
  });

  it('applies retained transforms without treating their canvas placeholder as geometry', () => {
    const operations = [{
      mode: 'replace' as const,
      shape: { kind: 'rectangle' as const, points: [{ x: 10, y: 20 }, { x: 30, y: 50 }] }
    }, {
      mode: 'transform' as const,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 7, ty: -3 },
      shape: { kind: 'rectangle' as const, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }
    }];
    expect(selectionOperationsBounds(operations, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 17, y: 17, width: 20, height: 30
    });
  });

  it('expands pixel support around feathered geometry without leaving the canvas', () => {
    const operations = [{
      mode: 'replace' as const,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 20, y: 15 }, { x: 60, y: 45 }]
      }
    }, {
      mode: 'feather' as const,
      amount: 12.4,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 0, y: 0 }, { x: 100, y: 80 }]
      }
    }];
    expect(selectionOperationsSupportBounds(
      operations,
      { x: 0, y: 0, width: 100, height: 80 }
    )).toEqual({ x: 0, y: 0, width: 86, height: 71 });
  });

  it('expands support for a feather captured on one marquee source', () => {
    expect(selectionOperationsSupportBounds([{
      mode: 'replace',
      amount: 6,
      shape: {
        kind: 'ellipse',
        points: [{ x: 20, y: 20 }, { x: 40, y: 50 }]
      }
    }], { x: 0, y: 0, width: 100, height: 80 })).toEqual({
      x: 7, y: 7, width: 46, height: 56
    });
  });
});
