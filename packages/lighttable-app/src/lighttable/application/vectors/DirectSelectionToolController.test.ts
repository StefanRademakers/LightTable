import { describe, expect, it, vi } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix
} from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createVectorEditorSelection,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import { DirectSelectionToolController } from './DirectSelectionToolController';
import { VectorDocumentController } from './VectorDocumentController';

const setup = () => {
  let document = createImageDocument('Direct selection', 300, 200, 'asset');
  let selection: VectorEditorSelection = createVectorEditorSelection();
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const documents = new VectorDocumentController(() => ({
    getDocument: () => document,
    applyDocumentSnapshot: (next) => { document = next; },
    pushDocumentHistory: (before, after) => { history.push({ before, after }); }
  }));
  const controller = new DirectSelectionToolController(documents, {
    getDocument: () => document,
    getSelection: () => selection,
    setSelection: vi.fn((next) => { selection = next; })
  });
  return {
    controller,
    documents,
    history,
    get document() { return document; },
    set document(next) { document = next; },
    get selection() { return selection; }
  };
};

const transformedPath = () => {
  const path = createVectorPath('path', 'Path', [
    createSubpath('subpath', [
      createAnchor('anchor', { x: 2, y: 3 }, {
        handleOut: { x: 7, y: 3 },
        mode: 'corner'
      }),
      createAnchor('end', { x: 20, y: 3 })
    ])
  ]);
  path.transform = rotationMatrix(Math.PI / 6);
  const layer = createVectorLayer([path]);
  layer.transform = scaleMatrix(2, 3);
  const group = createGroupLayer('Nested');
  group.transform = translationMatrix(40, 25);
  group.children = [layer];
  const localToDocument = multiplyMatrices(
    group.transform,
    multiplyMatrices(layer.transform, path.transform)
  );
  return { path, layer, group, localToDocument };
};

describe('DirectSelectionToolController', () => {
  it('publishes the final drag sample with a fresh geometry cache revision', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const start = transformPoint(scene.localToDocument, { x: 2, y: 3 });
    const middle = transformPoint(scene.localToDocument, { x: 5, y: 5 });
    const end = transformPoint(scene.localToDocument, { x: 12, y: 9 });

    expect(state.controller.pointerDown(start, { radius: 2 })).toBe(true);
    expect(state.controller.pointerMove(middle)).toBe(true);
    const middleLayer = findDocumentLayer(state.document, scene.layer.id);
    const middleRevision = middleLayer?.type === 'vector'
      ? middleLayer.elements[0]?.geometryRevision ?? -1
      : -1;
    expect(state.controller.pointerMove(end)).toBe(true);
    const endLayer = findDocumentLayer(state.document, scene.layer.id);
    const endRevision = endLayer?.type === 'vector'
      ? endLayer.elements[0]?.geometryRevision ?? -1
      : -1;

    expect(endRevision).toBeGreaterThan(middleRevision);
    expect(state.controller.pointerUp(end)).toBe(true);
    const committedLayer = findDocumentLayer(state.document, scene.layer.id);
    const committedPath = committedLayer?.type === 'vector' && committedLayer.elements[0]?.type === 'path'
      ? committedLayer.elements[0]
      : null;
    expect(committedPath?.subpaths[0]?.anchors[0]?.position.x).toBeCloseTo(12, 10);
    expect(committedPath?.subpaths[0]?.anchors[0]?.position.y).toBeCloseTo(9, 10);
    expect(committedPath?.geometryRevision).toBeGreaterThan(endRevision);
    expect(state.history).toHaveLength(1);
  });

  it('moves an anchor in path-local coordinates under nested scale and rotation', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const start = transformPoint(scene.localToDocument, { x: 2, y: 3 });
    const end = transformPoint(scene.localToDocument, { x: 8, y: 7 });

    expect(state.controller.pointerDown(start, { radius: 2 })).toBe(true);
    expect(state.controller.pointerMove(end)).toBe(true);
    expect(state.controller.pointerUp(end)).toBe(true);
    expect(state.history).toHaveLength(1);

    const layer = findDocumentLayer(state.document, scene.layer.id);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    const editedPath = layer.elements[0];
    expect(editedPath?.type === 'path' ? editedPath.subpaths[0]?.anchors[0]?.position : null).toEqual({ x: 8, y: 7 });
    expect(editedPath?.type === 'path' ? editedPath.subpaths[0]?.anchors[0]?.handleOut : null).toEqual({ x: 13, y: 7 });
    expect(state.selection.anchors).toEqual([{
      layerId: scene.layer.id,
      pathId: 'path',
      subpathId: 'subpath',
      anchorId: 'anchor'
    }]);
  });

  it('moves a handle through the same inverse scene transform', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const start = transformPoint(scene.localToDocument, { x: 7, y: 3 });
    const end = transformPoint(scene.localToDocument, { x: 9, y: 11 });

    state.controller.pointerDown(start, { radius: 1 });
    state.controller.pointerUp(end);

    const layer = findDocumentLayer(state.document, scene.layer.id);
    const handle = layer?.type === 'vector'
      ? layer.elements[0]?.type === 'path' ? layer.elements[0].subpaths[0]?.anchors[0]?.handleOut : null
      : null;
    expect(handle?.x).toBeCloseTo(9, 10);
    expect(handle?.y).toBeCloseTo(11, 10);
    expect(state.history).toHaveLength(1);
  });

  it('breaks one smooth handle while preserving the opposite handle', () => {
    const state = setup();
    const path = createVectorPath('path', 'Path', [createSubpath('subpath', [
      createAnchor('anchor', { x: 20, y: 20 }, {
        mode: 'symmetric',
        handleIn: { x: 10, y: 20 },
        handleOut: { x: 30, y: 20 }
      }),
      createAnchor('end', { x: 60, y: 20 })
    ])]);
    const layer = createVectorLayer([path]);
    state.document.layers = [layer];

    expect(state.controller.pointerDown({ x: 30, y: 20 }, {
      radius: 1,
      breakHandle: true
    })).toBe(true);
    expect(state.controller.pointerUp({ x: 35, y: 30 })).toBe(true);

    const edited = findDocumentLayer(state.document, layer.id);
    if (edited?.type !== 'vector' || edited.elements[0]?.type !== 'path') {
      throw new Error('Expected edited vector path.');
    }
    expect(edited.elements[0].subpaths[0]?.anchors[0]).toMatchObject({
      mode: 'corner',
      handleIn: { x: 10, y: 20 },
      handleOut: { x: 35, y: 30 }
    });
    expect(state.history).toHaveLength(1);
  });

  it('pulls a segment through the pointer while its anchors stay fixed', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const start = transformPoint(scene.localToDocument, { x: 11, y: 3 });
    const end = transformPoint(scene.localToDocument, { x: 11, y: 8 });

    expect(state.controller.pointerDown(start, { radius: 2 })).toBe(true);
    expect(state.selection.active?.target.kind).toBe('segment');
    expect(state.controller.pointerMove(end)).toBe(true);
    expect(state.controller.pointerUp(end)).toBe(true);

    const layer = findDocumentLayer(state.document, scene.layer.id);
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    const anchors = layer.elements[0]?.type === 'path' ? layer.elements[0].subpaths[0]?.anchors ?? [] : [];
    expect(anchors.map(({ position }) => position)).toEqual([
      { x: 2, y: 3 },
      { x: 20, y: 3 }
    ]);
    expect(anchors[0]?.handleOut?.y).toBeGreaterThan(3);
    expect(anchors[1]?.handleIn?.y).toBeGreaterThan(3);
    expect(state.history).toHaveLength(1);
  });

  it('restores the opening document and avoids history when cancelled', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const opening = state.document;
    const start = transformPoint(scene.localToDocument, { x: 2, y: 3 });
    const end = transformPoint(scene.localToDocument, { x: 12, y: 9 });

    state.controller.pointerDown(start, { radius: 2 });
    state.controller.pointerMove(end);
    expect(state.controller.cancel()).toBe(true);

    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });

  it('does not leak an active drag into a newly activated document', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const start = transformPoint(scene.localToDocument, { x: 2, y: 3 });
    state.controller.pointerDown(start, { radius: 2 });

    state.document = createImageDocument('Other', 10, 10, 'other');
    expect(state.controller.pointerMove({ x: 20, y: 20 })).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('marquee-selects transformed anchors without creating document history', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const first = transformPoint(scene.localToDocument, { x: 2, y: 3 });

    expect(state.controller.pointerDown(
      { x: first.x - 4, y: first.y - 4 },
      { radius: 1 }
    )).toBe(true);
    expect(state.controller.pointerMove({ x: first.x + 4, y: first.y + 4 })).toBe(true);
    expect(state.controller.marqueeRect()).toEqual({
      x: first.x - 4,
      y: first.y - 4,
      width: 8,
      height: 8
    });
    expect(state.controller.pointerUp({ x: first.x + 4, y: first.y + 4 })).toBe(true);
    expect(state.selection.anchors.map(({ anchorId }) => anchorId)).toEqual(['anchor']);
    expect(state.history).toHaveLength(0);
  });

  it('restores the opening selection when a marquee gesture is cancelled', () => {
    const state = setup();
    const scene = transformedPath();
    state.document.layers = [scene.group];
    const first = transformPoint(scene.localToDocument, { x: 2, y: 3 });
    state.controller.pointerDown(first, { radius: 2 });
    state.controller.pointerUp(first);
    const opening = state.selection;

    state.controller.pointerDown({ x: 0, y: 0 }, { radius: 1 });
    state.controller.pointerMove({ x: 300, y: 200 });
    expect(state.selection.anchors).toHaveLength(2);
    expect(state.controller.cancel()).toBe(true);
    expect(state.selection).toEqual(opening);
  });
});
