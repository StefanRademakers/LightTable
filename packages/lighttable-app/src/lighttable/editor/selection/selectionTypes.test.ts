import { describe, expect, it } from 'vitest';
import {
  createFeatherSelectionOperation,
  createFullCanvasSelection,
  createInvertSelectionOperation,
  selectionModeFromModifiers,
  selectionShapeIsValid
} from './selectionTypes';

describe('LightTable selections', () => {
  it('maps the standard selection modifiers to boolean modes', () => {
    expect(selectionModeFromModifiers(false, false)).toBe('replace');
    expect(selectionModeFromModifiers(true, false)).toBe('add');
    expect(selectionModeFromModifiers(false, true)).toBe('subtract');
    expect(selectionModeFromModifiers(true, true)).toBe('intersect');
  });

  it('rejects clicks and incomplete free selections', () => {
    expect(selectionShapeIsValid({ kind: 'rectangle', points: [{ x: 1, y: 1 }, { x: 1, y: 8 }] })).toBe(false);
    expect(selectionShapeIsValid({ kind: 'ellipse', points: [{ x: 1, y: 1 }, { x: 5, y: 8 }] })).toBe(true);
    expect(selectionShapeIsValid({ kind: 'free', points: [{ x: 1, y: 1 }, { x: 5, y: 8 }] })).toBe(false);
  });

  it('creates a replace operation covering the complete document canvas', () => {
    expect(createFullCanvasSelection(1920, 1080)).toEqual([{
      mode: 'replace',
      shape: {
        kind: 'rectangle',
        points: [{ x: 0, y: 0 }, { x: 1920, y: 1080 }]
      }
    }]);
  });

  it('creates replayable invert and feather operations', () => {
    expect(createInvertSelectionOperation(100, 50)).toMatchObject({
      mode: 'invert',
      shape: { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }
    });
    expect(createFeatherSelectionOperation(100, 50, 12)).toMatchObject({
      mode: 'feather',
      amount: 12
    });
    expect(createFeatherSelectionOperation(100, 50, -4).amount).toBe(0);
  });
});
