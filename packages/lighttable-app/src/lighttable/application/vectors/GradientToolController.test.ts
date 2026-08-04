import { describe, expect, it } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { VectorDocumentController } from './VectorDocumentController';
import {
  constrainedGradientEnd,
  GradientToolController,
  gradientPaintFromDrag
} from './GradientToolController';

describe('GradientToolController', () => {
  it('constrains drag direction to 45 degree increments', () => {
    const end = constrainedGradientEnd({ x: 10, y: 20 }, { x: 110, y: 52 }, true);
    expect(end.y).toBeCloseTo(20);
    expect(Math.hypot(end.x - 10, end.y - 20)).toBeCloseTo(Math.hypot(100, 32));
  });

  it('keeps reusable assets immutable and can ignore opacity stops', () => {
    const source = createDefaultGradientPaint('tool', 'object-bounds');
    source.asset.opacityStops[0]!.opacity = 0.2;
    const result = gradientPaintFromDrag(
      source,
      { x: 5, y: 7 },
      { x: 105, y: 7 },
      false
    );
    expect(result).toMatchObject({
      coordinateSpace: 'document',
      transform: { a: 100, b: 0, c: -0, d: 100, tx: 5, ty: 7 }
    });
    expect(result.asset.opacityStops.every(({ opacity }) => opacity === 1)).toBe(true);
    expect(source.asset.opacityStops[0]!.opacity).toBe(0.2);
  });

  it('previews and commits one semantic editable Gradient Fill layer', () => {
    let document = createImageDocument('Gradient', 320, 180, 'asset');
    const history: Array<{ before: typeof document; after: typeof document }> = [];
    const documents = new VectorDocumentController(() => ({
      getDocument: () => document,
      applyDocumentSnapshot: (next) => { document = next; },
      pushDocumentHistory: (before, after) => history.push({ before, after })
    }));
    const controller = new GradientToolController(documents, () => ({
      paint: createDefaultGradientPaint('gesture', 'document'),
      opacity: 0.75,
      blendMode: 'multiply',
      transparency: true
    }));

    expect(controller.pointerDown({ x: 20, y: 30 })).toBe(true);
    expect(controller.pointerMove({ x: 220, y: 30 })).toBe(true);
    expect(controller.pointerUp({ x: 250, y: 30 })).toBe(true);
    expect(history).toHaveLength(1);
    const layer = findDocumentLayer(document, document.activeLayerId);
    expect(layer).toMatchObject({
      type: 'vector', role: 'gradient-fill', name: 'Gradient Fill',
      opacity: 0.75, blendMode: 'multiply'
    });
    if (layer?.type !== 'vector') throw new Error('Expected Gradient Fill layer.');
    expect(layer.elements).toHaveLength(1);
    expect(layer.elements[0]).toMatchObject({
      type: 'live-shape',
      geometry: { kind: 'rectangle', width: 320, height: 180 },
      style: { fill: { kind: 'gradient', coordinateSpace: 'document' }, opacity: 1 }
    });
  });
});
