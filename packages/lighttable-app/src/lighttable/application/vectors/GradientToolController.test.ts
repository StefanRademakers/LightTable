import { describe, expect, it } from 'vitest';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { VectorDocumentController } from './VectorDocumentController';
import {
  constrainedGradientEnd,
  GradientToolController,
  gradientPaintFromDrag,
  gradientTransformFromAxis
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

  it('always constructs the orthogonal basis consumed by every gradient shader', () => {
    expect(gradientTransformFromAxis({ x: 40, y: 50 }, { x: 300, y: 80 })).toEqual({
      a: 260, b: 30, c: -30, d: 260, tx: 40, ty: 50
    });
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

  it('keeps the active Gradient Fill selected and edits it instead of adding layers', () => {
    let document = createImageDocument('Gradient', 320, 180, 'asset');
    const history: Array<{ before: typeof document; after: typeof document }> = [];
    const selected: Array<{ layerId: string; elementId: string }> = [];
    const documents = new VectorDocumentController(() => ({
      getDocument: () => document,
      applyDocumentSnapshot: (next) => { document = next; },
      pushDocumentHistory: (before, after) => history.push({ before, after })
    }));
    const controller = new GradientToolController(documents, () => ({
      paint: createDefaultGradientPaint('gesture', 'document'),
      opacity: 1,
      blendMode: 'normal',
      transparency: true
    }), (target) => selected.push(target));

    controller.pointerDown({ x: 20, y: 30 }, 6);
    controller.pointerMove({ x: 220, y: 30 });
    expect(selected).toEqual([{ layerId: document.activeLayerId, elementId: expect.any(String) }]);
    expect(controller.pointerUp({ x: 250, y: 30 })).toBe(true);
    const gradientLayerId = document.activeLayerId;
    const layerCount = document.layers.length;
    expect(selected).toEqual([{ layerId: gradientLayerId, elementId: expect.any(String) }]);

    controller.pointerDown({ x: 40, y: 50 }, 6);
    controller.pointerMove({ x: 260, y: 50 });
    expect(controller.pointerUp({ x: 280, y: 50 })).toBe(true);
    expect(document.layers).toHaveLength(layerCount);
    expect(document.activeLayerId).toBe(gradientLayerId);
    expect(history).toHaveLength(2);

    const layer = findDocumentLayer(document, gradientLayerId);
    if (layer?.type !== 'vector') throw new Error('Expected Gradient Fill layer.');
    const fillAfterAxisEdit = layer.elements[0]?.style.fill;
    expect(fillAfterAxisEdit && 'kind' in fillAfterAxisEdit
      ? fillAfterAxisEdit.transform
      : null).toMatchObject({ a: 240, b: 0, tx: 40, ty: 50 });

    controller.pointerDown({ x: 280, y: 50 }, 8);
    controller.pointerMove({ x: 300, y: 80 });
    expect(controller.pointerUp({ x: 300, y: 80 })).toBe(true);
    expect(document.layers).toHaveLength(layerCount);
    expect(history).toHaveLength(3);
    const endpointLayer = findDocumentLayer(document, gradientLayerId);
    if (endpointLayer?.type !== 'vector') throw new Error('Expected Gradient Fill layer.');
    const fillAfterEndpointEdit = endpointLayer.elements[0]?.style.fill;
    expect(fillAfterEndpointEdit && 'kind' in fillAfterEndpointEdit
      ? fillAfterEndpointEdit.transform
      : null).toEqual({ a: 260, b: 30, c: -30, d: 260, tx: 40, ty: 50 });
  });

  it('translates the complete gradient when dragging its line body', () => {
    let document = createImageDocument('Gradient', 320, 180, 'asset');
    const history: Array<{ before: typeof document; after: typeof document }> = [];
    const documents = new VectorDocumentController(() => ({
      getDocument: () => document,
      applyDocumentSnapshot: (next) => { document = next; },
      pushDocumentHistory: (before, after) => history.push({ before, after })
    }));
    const controller = new GradientToolController(documents, () => ({
      paint: createDefaultGradientPaint('gesture', 'document'), opacity: 1,
      blendMode: 'normal', transparency: true
    }));

    controller.pointerDown({ x: 20, y: 30 }, 8);
    controller.pointerMove({ x: 250, y: 30 });
    controller.pointerUp({ x: 250, y: 30 });
    controller.pointerDown({ x: 100, y: 30 }, 8);
    controller.pointerMove({ x: 110, y: 50 });
    expect(controller.pointerUp({ x: 110, y: 50 })).toBe(true);

    const layer = findDocumentLayer(document, document.activeLayerId);
    if (layer?.type !== 'vector') throw new Error('Expected Gradient Fill layer.');
    const fill = layer.elements[0]?.style.fill;
    expect(fill && 'kind' in fill ? fill.transform : null).toEqual({
      a: 230, b: 0, c: -0, d: 230, tx: 30, ty: 50
    });
    expect(history).toHaveLength(2);
  });

  it('redraws the selected fill without creating a second layer when dragging away from its gizmo', () => {
    let document = createImageDocument('Gradient', 320, 180, 'asset');
    const documents = new VectorDocumentController(() => ({
      getDocument: () => document,
      applyDocumentSnapshot: (next) => { document = next; },
      pushDocumentHistory: () => undefined
    }));
    const controller = new GradientToolController(documents, () => ({
      paint: createDefaultGradientPaint('gesture', 'document'), opacity: 1,
      blendMode: 'normal', transparency: true
    }));

    controller.pointerDown({ x: 20, y: 30 }, 8);
    controller.pointerMove({ x: 250, y: 30 });
    controller.pointerUp({ x: 250, y: 30 });
    const layerCount = document.layers.length;
    controller.pointerDown({ x: 40, y: 70 }, 8);
    controller.pointerMove({ x: 100, y: 100 });
    expect(controller.pointerUp({ x: 100, y: 100 })).toBe(true);

    expect(document.layers).toHaveLength(layerCount);
    const layer = findDocumentLayer(document, document.activeLayerId);
    if (layer?.type !== 'vector') throw new Error('Expected Gradient Fill layer.');
    const fill = layer.elements[0]?.style.fill;
    expect(fill && 'kind' in fill ? fill.transform : null).toEqual({
      a: 60, b: 30, c: -30, d: 60, tx: 40, ty: 70
    });
  });
});
