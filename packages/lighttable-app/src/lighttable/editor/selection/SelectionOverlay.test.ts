import { describe, expect, it } from 'vitest';
import {
  createRasterViewportTransform,
  createVectorViewportTransform,
  getPrimitiveSelectionBounds,
  isDirectVectorSelection
} from './SelectionOverlay';
import type { SelectionOperation } from './selectionTypes';

const rectangle: SelectionOperation = {
  mode: 'replace',
  shape: {
    kind: 'rectangle',
    points: [{ x: 10, y: 20 }, { x: 110, y: 120 }]
  }
};

describe('isDirectVectorSelection', () => {
  it('keeps a single committed shape on the cheap vector overlay path', () => {
    expect(isDirectVectorSelection([rectangle])).toBe(true);
  });

  it('keeps composite and feathered selections on the mask path', () => {
    expect(isDirectVectorSelection([
      rectangle,
      { ...rectangle, mode: 'add' }
    ])).toBe(false);
    expect(isDirectVectorSelection([{
      ...rectangle,
      mode: 'feather',
      amount: 8
    }])).toBe(false);
  });
});

describe('createRasterViewportTransform', () => {
  it('projects a cached mask into a panned and zoomed viewport', () => {
    expect(createRasterViewportTransform(
      { imageX: 100, imageY: 50, scale: 1 },
      { imageX: 40, imageY: 20, scale: 2 }
    )).toBe('translate(-160px, -80px) scale(2)');
  });
});

describe('createVectorViewportTransform', () => {
  it('keeps committed geometry in document coordinates and projects its composited overlay', () => {
    expect(createVectorViewportTransform({ x: 120, y: 45 }, 2.5))
      .toBe('translate(120px, 45px) scale(2.5)');
  });
});

describe('getPrimitiveSelectionBounds', () => {
  it('bounds primitive selections without allocating a document-sized overlay', () => {
    expect(getPrimitiveSelectionBounds({
      kind: 'ellipse',
      points: [{ x: 80, y: 100 }, { x: 20, y: 40 }]
    })).toEqual({
      kind: 'ellipse',
      left: 20,
      top: 40,
      width: 60,
      height: 60
    });
  });
});
