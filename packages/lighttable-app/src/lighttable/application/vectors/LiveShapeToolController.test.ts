import { describe, expect, it, vi } from 'vitest';
import {
  multiplyMatrices,
  scaleMatrix,
  translationMatrix,
  type VectorIdSource
} from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  LiveShapeToolController,
  createLiveShapeFromDrag,
  resolveLiveShapeDrag
} from './LiveShapeToolController';
import { VectorDocumentController } from './VectorDocumentController';

const setup = () => {
  let document = createImageDocument('Shapes', 200, 100, 'asset');
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const dependencies = {
    getDocument: () => document,
    applyDocumentSnapshot: vi.fn((next: typeof document) => { document = next; }),
    pushDocumentHistory: vi.fn((before: typeof document, after: typeof document) => {
      history.push({ before, after });
    })
  };
  const documents = new VectorDocumentController(() => dependencies);
  const ids: VectorIdSource = { next: (kind) => `${kind}-1` };
  return {
    documents,
    ids,
    history,
    get document() { return document; },
    replaceDocument(next: typeof document) { document = next; }
  };
};

describe('createLiveShapeFromDrag', () => {
  const style = { fill: { type: 'solid' as const, color: [1, 0, 0, 1] as const }, stroke: null, opacity: 1 };

  it('normalizes reverse rectangle drags into positive local geometry', () => {
    const shape = createLiveShapeFromDrag(
      'rectangle', { x: 80, y: 60 }, { x: 20, y: 10 }, { kind: 'rectangle' }, style
    );
    expect(shape.geometry).toMatchObject({ kind: 'rectangle', width: 60, height: 50 });
    expect(shape.transform).toMatchObject({ tx: 20, ty: 10 });
  });

  it('uses radial document-space construction for stars', () => {
    const shape = createLiveShapeFromDrag(
      'star', { x: 50, y: 40 }, { x: 53, y: 44 },
      { kind: 'star', points: 7, innerRatio: 0.4 }, style
    );
    expect(shape.geometry).toMatchObject({
      kind: 'star', points: 7, outerRadius: 5, innerRadius: 2
    });
    expect(shape.transform).toMatchObject({ tx: 50, ty: 40 });
  });

  it('keeps line shapes stroke-only even when the current shape fill is enabled', () => {
    const shape = createLiveShapeFromDrag(
      'line', { x: 10, y: 10 }, { x: 80, y: 40 }, { kind: 'line' }, {
        ...style,
        stroke: {
          paint: { type: 'solid', color: [0, 0, 0, 1] },
          width: 3,
          cap: 'round',
          join: 'round',
          miterLimit: 4,
          dash: [],
          dashOffset: 0
        }
      }
    );
    expect(shape.style.fill).toBeNull();
    expect(shape.style.stroke?.width).toBe(3);
  });

  it('keeps independent parametric arrowheads on an editable line', () => {
    const shape = createLiveShapeFromDrag(
      'arrow-line', { x: 10, y: 10 }, { x: 110, y: 40 }, {
        kind: 'line',
        startArrow: { width: 12, length: 18, concavity: 0 },
        endArrow: { width: 20, length: 28, concavity: 0.25 }
      }, style
    );
    expect(shape.geometry).toMatchObject({
      kind: 'line',
      startArrow: { width: 12, length: 18, concavity: 0 },
      endArrow: { width: 20, length: 28, concavity: 0.25 }
    });
  });
});

describe('resolveLiveShapeDrag', () => {
  it('draws box shapes from their centre while preserving equal sides', () => {
    expect(resolveLiveShapeDrag(
      { x: 50, y: 40 },
      { x: 70, y: 50 },
      { kind: 'rectangle' },
      { fromCenter: true, preserveAspect: true }
    )).toEqual([
      { x: 30, y: 20 },
      { x: 70, y: 60 }
    ]);
  });

  it('constrains lines to the nearest 45-degree direction', () => {
    const [, current] = resolveLiveShapeDrag(
      { x: 10, y: 10 },
      { x: 31, y: 19 },
      { kind: 'line' },
      { preserveAspect: true }
    );
    expect(current.x).toBeCloseTo(26.15, 1);
    expect(current.y).toBeCloseTo(26.15, 1);
  });

  it('uses exact full dimensions in fixed-size centre mode', () => {
    expect(resolveLiveShapeDrag(
      { x: 50.4, y: 40.4 },
      { x: 80.1, y: 60.2 },
      { kind: 'ellipse' },
      { fromCenter: true, fixedSize: { x: 120, y: 80 }, snapToPixels: true }
    )).toEqual([
      { x: -10, y: 0 },
      { x: 110, y: 80 }
    ]);
  });

  it('preserves the configured proportional ratio in either drag direction', () => {
    const [start, end] = resolveLiveShapeDrag(
      { x: 20, y: 20 },
      { x: 50, y: 80 },
      { kind: 'rectangle' },
      { proportionalRatio: 2 }
    );
    expect(start).toEqual({ x: 20, y: 20 });
    expect(end).toEqual({ x: 140, y: 80 });
  });

  it('snaps authored endpoints to whole document pixels', () => {
    expect(resolveLiveShapeDrag(
      { x: 10.4, y: 12.6 },
      { x: 40.6, y: 50.2 },
      { kind: 'rectangle' },
      { snapToPixels: true }
    )).toEqual([{ x: 10, y: 13 }, { x: 41, y: 50 }]);
  });
});

describe('LiveShapeToolController', () => {
  it('coalesces a complete drag into one document history entry', () => {
    const state = setup();
    const opening = state.document;
    const tool = new LiveShapeToolController(state.documents, { kind: 'ellipse' }, { ids: state.ids });

    expect(tool.pointerDown({ x: 10, y: 15 })).toBe(true);
    expect(tool.pointerMove({ x: 30, y: 35 })).toBe(true);
    expect(tool.pointerMove({ x: 70, y: 45 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(tool.pointerUp({ x: 80, y: 55 })).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.before).toBe(opening);

    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    const shape = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(shape).toMatchObject({
      id: 'live-shape-1',
      type: 'live-shape',
      geometry: { kind: 'ellipse', width: 70, height: 40 },
      transform: { tx: 10, ty: 15 }
    });
    expect(shape?.geometryRevision).toBe(2);
    expect(shape?.transformRevision).toBe(2);
  });

  it('advances render-cache revisions for every changed drag preview', () => {
    const state = setup();
    const tool = new LiveShapeToolController(
      state.documents,
      { kind: 'rectangle' },
      { ids: state.ids }
    );

    tool.pointerDown({ x: 10, y: 10 });
    tool.pointerMove({ x: 20, y: 20 });
    let layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    let shape = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(shape).toMatchObject({ geometryRevision: 0, transformRevision: 0 });

    tool.pointerMove({ x: 90, y: 70 });
    layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    shape = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(shape).toMatchObject({
      geometry: { kind: 'rectangle', width: 80, height: 60 },
      geometryRevision: 1,
      transformRevision: 1
    });
  });

  it('moves a line without resizing while Space is held during its drag', () => {
    const state = setup();
    const tool = new LiveShapeToolController(
      state.documents,
      { kind: 'line' },
      { ids: state.ids }
    );

    tool.pointerDown({ x: 10, y: 10 });
    tool.pointerMove({ x: 50, y: 30 });
    tool.pointerMove({ x: 65, y: 38 }, { moveOrigin: true });
    tool.pointerUp({ x: 65, y: 38 });

    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    const shape = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(shape).toMatchObject({
      geometry: { kind: 'line', end: { x: 40, y: 20 } },
      transform: { tx: 25, ty: 18 }
    });
  });

  it('updates angle and centre modifiers while a line gesture is active', () => {
    const state = setup();
    const tool = new LiveShapeToolController(
      state.documents,
      { kind: 'line' },
      { ids: state.ids }
    );

    tool.pointerDown({ x: 40, y: 40 });
    tool.pointerMove(
      { x: 60, y: 50 },
      { preserveAspect: true, fromCenter: true }
    );
    tool.pointerUp(
      { x: 60, y: 50 },
      { preserveAspect: true, fromCenter: true }
    );

    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    const shape = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(shape?.transform.tx).toBeCloseTo(24.19, 1);
    expect(shape?.transform.ty).toBeCloseTo(24.19, 1);
    if (shape?.type !== 'live-shape' || shape.geometry.kind !== 'line') {
      throw new Error('Expected a line shape.');
    }
    expect(shape.geometry.end.x).toBeCloseTo(31.62, 1);
    expect(shape.geometry.end.y).toBeCloseTo(31.62, 1);
  });

  it('rebases every preview through a transformed nested vector layer', () => {
    const state = setup();
    const group = createGroupLayer('Nested');
    group.transform = multiplyMatrices(translationMatrix(30, -4), scaleMatrix(2, 3));
    const layer = createVectorLayer([], 'Shapes');
    layer.transform = translationMatrix(7, 11);
    group.children = [layer];
    state.replaceDocument({ ...state.document, layers: [group], activeLayerId: layer.id });
    const tool = new LiveShapeToolController(state.documents, { kind: 'rectangle' }, { ids: state.ids });

    tool.pointerDown({ x: 40, y: 20 });
    tool.pointerMove({ x: 60, y: 50 });
    tool.pointerUp({ x: 80, y: 65 });

    const storedLayer = findDocumentLayer(state.document, layer.id);
    const shape = storedLayer?.type === 'vector' ? storedLayer.elements[0] : null;
    const layerToDocument = multiplyMatrices(group.transform, layer.transform);
    expect(shape?.type).toBe('live-shape');
    if (shape?.type !== 'live-shape') throw new Error('Expected live shape.');
    expect(multiplyMatrices(layerToDocument, shape.transform)).toEqual(translationMatrix(40, 20));
  });

  it('cancels a provisional layer back to the exact opening snapshot', () => {
    const state = setup();
    const opening = state.document;
    const tool = new LiveShapeToolController(state.documents, { kind: 'triangle' }, { ids: state.ids });
    tool.pointerDown({ x: 5, y: 5 });
    tool.pointerMove({ x: 30, y: 25 });

    expect(tool.cancel()).toBe(true);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });

  it('does not create click-sized accidental shapes', () => {
    const state = setup();
    const opening = state.document;
    const tool = new LiveShapeToolController(
      state.documents,
      { kind: 'rectangle' },
      { ids: state.ids, minimumDragDistance: 2 }
    );
    tool.pointerDown({ x: 10, y: 10 });

    expect(tool.pointerUp({ x: 11, y: 11 })).toBe(false);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });
});
