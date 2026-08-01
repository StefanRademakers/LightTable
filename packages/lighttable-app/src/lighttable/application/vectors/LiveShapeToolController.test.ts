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
import { LiveShapeToolController, createLiveShapeFromDrag } from './LiveShapeToolController';
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
