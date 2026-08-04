import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SelectionOverlay,
  createRasterViewportTransform,
  createVectorViewportTransform,
  getPrimitiveSelectionBounds,
  isDirectVectorSelection
} from './SelectionOverlay';
import type { SelectionOperation } from './selectionTypes';
import { selectionStripShape } from '../tools/selection/selectionGestureController';

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

describe('SelectionOverlay dimensions', () => {
  it.each(['rectangle', 'ellipse'] as const)(
    'shows W, H, X and Y while drawing a %s selection',
    (kind) => {
      const markup = renderToStaticMarkup(React.createElement(SelectionOverlay, {
        operations: [],
        draft: {
          kind,
          points: [{ x: 110, y: 90 }, { x: 30, y: 20 }]
        },
        imageRect: { x: 0, y: 0, width: 320, height: 180 },
        scale: 1,
        width: 640,
        height: 480
      }));
      expect(markup).toContain('W: 80 px');
      expect(markup).toContain('H: 70 px');
      expect(markup).toContain('X: 30 px');
      expect(markup).toContain('Y: 20 px');
    }
  );

  it('shows the same measurements for horizontal and vertical strip geometry', () => {
    for (const tool of ['select-horizontal', 'select-vertical'] as const) {
      const markup = renderToStaticMarkup(React.createElement(SelectionOverlay, {
        operations: [],
        draft: selectionStripShape(tool, { x: 30, y: 20 }, {
          documentWidth: 320,
          documentHeight: 180,
          size: 1
        }),
        imageRect: { x: 0, y: 0, width: 320, height: 180 },
        scale: 1,
        width: 640,
        height: 480
      }));
      expect(markup).toContain('W:');
      expect(markup).toContain('H:');
      expect(markup).toContain('X:');
      expect(markup).toContain('Y:');
      expect(markup).toContain('1 px');
    }
  });
});
