import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
  type VectorIdSource
} from '@lighttable/vector-core';
import {
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createVectorEditorSelection,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import { VectorSelectionCommandController } from './VectorSelectionCommandController';

const path = (id: string, anchorPrefix: string) => createVectorPath(id, id, [
  createSubpath(`${id}-subpath`, [
    createAnchor(`${anchorPrefix}-a`, { x: 0, y: 0 }, {
      handleOut: { x: 25, y: 0 },
      mode: 'corner'
    }),
    createAnchor(`${anchorPrefix}-b`, { x: 100, y: 0 }, {
      handleIn: { x: 75, y: 0 },
      mode: 'corner'
    })
  ])
]);

const ids = (): VectorIdSource => ({ next: () => 'inserted-anchor' });

const setup = () => {
  let document = createImageDocument('Commands', 200, 100, 'asset');
  const first = createVectorLayer([path('first-path', 'first')]);
  const second = createVectorLayer([path('second-path', 'second')]);
  document.layers = [first, second];
  document.activeLayerId = first.id;
  let selection: VectorEditorSelection = createVectorEditorSelection();
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const documents = new VectorDocumentController(() => ({
    getDocument: () => document,
    applyDocumentSnapshot: (next) => { document = next; },
    pushDocumentHistory: (before, after) => history.push({ before, after })
  }));
  const controller = new VectorSelectionCommandController(documents, {
    getDocument: () => document,
    getSelection: () => selection,
    setSelection: (next) => { selection = next; }
  }, ids());
  return {
    controller,
    first,
    second,
    history,
    get document() { return document; },
    get selection() { return selection; },
    set selection(next) { selection = next; }
  };
};

describe('VectorSelectionCommandController', () => {
  it('deletes anchors from multiple layers in one history entry', () => {
    const state = setup();
    state.selection = {
      paths: [],
      anchors: [
        {
          layerId: state.first.id,
          pathId: 'first-path',
          subpathId: 'first-path-subpath',
          anchorId: 'first-a'
        },
        {
          layerId: state.second.id,
          pathId: 'second-path',
          subpathId: 'second-path-subpath',
          anchorId: 'second-b'
        }
      ],
      active: null
    };

    expect(state.controller.deleteSelection()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.selection).toEqual(createVectorEditorSelection());
    const first = findDocumentLayer(state.document, state.first.id);
    const second = findDocumentLayer(state.document, state.second.id);
    expect(first?.type === 'vector' ? first.paths[0]?.subpaths[0]?.anchors[0]?.id : null)
      .toBe('first-b');
    expect(second?.type === 'vector' ? second.paths[0]?.subpaths[0]?.anchors[0]?.id : null)
      .toBe('second-a');
  });

  it('aborts a multi-path command when any target is locked', () => {
    const state = setup();
    state.second.locks.pixels = true;
    const opening = state.document;
    state.selection = {
      paths: [],
      anchors: [
        {
          layerId: state.first.id,
          pathId: 'first-path',
          subpathId: 'first-path-subpath',
          anchorId: 'first-a'
        },
        {
          layerId: state.second.id,
          pathId: 'second-path',
          subpathId: 'second-path-subpath',
          anchorId: 'second-a'
        }
      ],
      active: null
    };

    expect(state.controller.deleteSelection()).toBe(false);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
    expect(state.selection.anchors).toHaveLength(2);
  });

  it('converts all selected anchors atomically', () => {
    const state = setup();
    state.selection = {
      paths: [],
      anchors: [{
        layerId: state.first.id,
        pathId: 'first-path',
        subpathId: 'first-path-subpath',
        anchorId: 'first-a'
      }],
      active: null
    };

    expect(state.controller.setSelectedAnchorMode('symmetric')).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.first.id);
    expect(layer?.type === 'vector'
      ? layer.paths[0]?.subpaths[0]?.anchors[0]?.mode
      : null).toBe('symmetric');
  });

  it('inserts an exact segment anchor and selects it', () => {
    const state = setup();
    state.selection = {
      paths: [],
      anchors: [],
      active: {
        layerId: state.first.id,
        pathId: 'first-path',
        target: {
          kind: 'segment',
          subpathId: 'first-path-subpath',
          segmentIndex: 0,
          t: 0.4,
          point: { x: 40, y: 0 }
        }
      }
    };

    expect(state.controller.insertAnchorAtActiveSegment()).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.first.id);
    expect(layer?.type === 'vector'
      ? layer.paths[0]?.subpaths[0]?.anchors.map(({ id }) => id)
      : []).toEqual(['first-a', 'inserted-anchor', 'first-b']);
    expect(state.selection.anchors[0]?.anchorId).toBe('inserted-anchor');
  });

  it('nudges anchors in document pixels through transformed path geometry', () => {
    const state = setup();
    const layer = findDocumentLayer(state.document, state.first.id);
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    layer.transform = scaleMatrix(2, 3);
    layer.paths[0].transform = rotationMatrix(Math.PI / 4);
    state.selection = {
      paths: [],
      anchors: [{
        layerId: state.first.id,
        pathId: 'first-path',
        subpathId: 'first-path-subpath',
        anchorId: 'first-a'
      }],
      active: null
    };
    const before = transformPoint(
      multiplyMatrices(layer.transform, layer.paths[0].transform),
      { x: 0, y: 0 }
    );

    expect(state.controller.nudgeSelection({ x: 7, y: -5 })).toBe(true);
    const updated = findDocumentLayer(state.document, state.first.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    const after = transformPoint(
      multiplyMatrices(updated.transform, updated.paths[0].transform),
      updated.paths[0].subpaths[0].anchors[0].position
    );
    expect(after.x - before.x).toBeCloseTo(7, 8);
    expect(after.y - before.y).toBeCloseTo(-5, 8);
    expect(state.history).toHaveLength(1);
  });

  it('nudges whole paths in document pixels without baking geometry', () => {
    const state = setup();
    const layer = findDocumentLayer(state.document, state.first.id);
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    layer.transform = scaleMatrix(2, 4);
    layer.paths[0].transform = translationMatrix(10, 20);
    const openingAnchor = { ...layer.paths[0].subpaths[0].anchors[0].position };
    state.selection = {
      paths: [{ layerId: state.first.id, pathId: 'first-path' }],
      anchors: [],
      active: null
    };

    expect(state.controller.nudgeSelection({ x: 8, y: -12 })).toBe(true);
    const updated = findDocumentLayer(state.document, state.first.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.paths[0].subpaths[0].anchors[0].position).toEqual(openingAnchor);
    expect(updated.paths[0].transform.tx).toBeCloseTo(14, 8);
    expect(updated.paths[0].transform.ty).toBeCloseTo(17, 8);
  });
});
