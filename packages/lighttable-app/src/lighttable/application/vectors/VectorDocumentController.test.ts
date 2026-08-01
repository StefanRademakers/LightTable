import { describe, expect, it, vi } from 'vitest';
import {
  createVectorLiveShape,
  createVectorPath,
  multiplyMatrices,
  scaleMatrix,
  transformPoint,
  translationMatrix,
  translateVectorPath
} from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { VectorDocumentController } from './VectorDocumentController';

const setup = () => {
  let document = createImageDocument('Vectors', 100, 50, 'asset');
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const dependencies = {
    getDocument: () => document,
    applyDocumentSnapshot: vi.fn((next: typeof document) => { document = next; }),
    pushDocumentHistory: vi.fn((before: typeof document, after: typeof document) => {
      history.push({ before, after });
    })
  };
  return {
    controller: new VectorDocumentController(() => dependencies),
    dependencies,
    history,
    get document() { return document; },
    replaceDocument(next: typeof document) { document = next; }
  };
};

describe('VectorDocumentController', () => {
  it('records an atomic vector layer insertion', () => {
    const state = setup();
    expect(state.controller.createLayer([createVectorPath('path')])).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(findDocumentLayer(state.document, state.document.activeLayerId!)?.type).toBe('vector');
  });

  it('coalesces many path previews into one history entry', () => {
    const state = setup();
    state.controller.createLayer([createVectorPath('path')]);
    state.history.length = 0;
    const layerId = state.document.activeLayerId!;

    expect(state.controller.beginPathMutation(layerId, 'path')).toBe(true);
    expect(state.controller.previewPathMutation((path) => translateVectorPath(path, { x: 2, y: 0 })))
      .toBe(true);
    expect(state.controller.previewPathMutation((path) => translateVectorPath(path, { x: 7, y: 3 })))
      .toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.commitPathMutation()).toBe(true);
    expect(state.history).toHaveLength(1);

    const layer = findDocumentLayer(state.document, layerId);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.elements[0]?.transform).toMatchObject({ tx: 7, ty: 3 });
  });

  it('constructs a new path as one document transaction', () => {
    const state = setup();
    const opening = state.document;
    const path = createVectorPath('pen-path');

    const placement = state.controller.beginPathCreation(path);
    expect(placement).not.toBeNull();
    expect(state.history).toHaveLength(0);

    const preview = translateVectorPath(path, { x: 12, y: 5 });
    expect(state.controller.previewPathCreation(preview)).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.commitPathCreation()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.before).toBe(opening);

    const layer = findDocumentLayer(state.document, placement!.layerId);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.elements[0]?.transform).toMatchObject({ tx: 12, ty: 5 });
  });

  it('constructs and previews a live shape as one document transaction', () => {
    const state = setup();
    const opening = state.document;
    const shape = createVectorLiveShape('ellipse', {
      kind: 'ellipse', width: 1, height: 1
    });
    shape.transform = translationMatrix(10, 12);

    const placement = state.controller.beginElementCreation(shape);
    expect(placement).not.toBeNull();
    expect(state.history).toHaveLength(0);

    const preview = createVectorLiveShape(shape.id, {
      kind: 'ellipse', width: 48, height: 24
    });
    preview.transform = translationMatrix(10, 12);
    expect(state.controller.previewElementCreation(preview)).toBe(true);
    expect(state.controller.commitElementCreation()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.before).toBe(opening);

    const layer = findDocumentLayer(state.document, placement!.layerId);
    const result = layer?.type === 'vector' ? layer.elements[0] : null;
    expect(result).toMatchObject({
      id: shape.id,
      type: 'live-shape',
      geometry: { kind: 'ellipse', width: 48, height: 24 },
      transform: { tx: 10, ty: 12 }
    });
  });

  it('converts a live shape through the atomic application boundary', () => {
    const state = setup();
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse', width: 20, height: 10
    });
    state.controller.createLayer([shape]);
    state.history.length = 0;
    const layerId = state.document.activeLayerId!;

    expect(state.controller.convertLiveShapeToPath(layerId, shape.id)).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, layerId);
    expect(layer?.type === 'vector' ? layer.elements[0]?.type : null).toBe('path');
  });

  it('appends a provisional path to an editable active vector layer', () => {
    const state = setup();
    state.controller.createLayer([createVectorPath('existing')]);
    const layerId = state.document.activeLayerId!;
    state.history.length = 0;

    expect(state.controller.beginPathCreation(createVectorPath('new'))?.layerId).toBe(layerId);
    const layer = findDocumentLayer(state.document, layerId);
    expect(layer?.type === 'vector' ? layer.elements.map(({ id }) => id) : []).toEqual([
      'existing',
      'new'
    ]);
    expect(state.controller.commitPathCreation()).toBe(true);
    expect(state.history).toHaveLength(1);
  });

  it('restores a newly inserted provisional layer on creation cancel', () => {
    const state = setup();
    const opening = state.document;
    expect(state.controller.beginPathCreation(createVectorPath('cancelled'))).not.toBeNull();

    expect(state.controller.cancelPathCreation()).toBe(true);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });

  it('rebases document-space creation into a transformed nested vector layer', () => {
    const state = setup();
    const group = createGroupLayer('Nested');
    group.transform = multiplyMatrices(translationMatrix(30, -4), scaleMatrix(2, 3));
    const layer = createVectorLayer([], 'Paths');
    layer.transform = translationMatrix(7, 11);
    group.children = [layer];
    state.replaceDocument({
      ...state.document,
      layers: [group],
      activeLayerId: layer.id
    });

    const placement = state.controller.beginPathCreation(createVectorPath('nested'));
    expect(placement?.layerId).toBe(layer.id);
    expect(placement?.pathToDocument).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(transformPoint(placement!.documentToPath, { x: 42, y: 19 })).toEqual({ x: 42, y: 19 });

    const stored = findDocumentLayer(state.document, layer.id);
    const path = stored?.type === 'vector' && stored.elements[0]?.type === 'path' ? stored.elements[0] : null;
    const layerToDocument = multiplyMatrices(group.transform, layer.transform);
    expect(path).not.toBeNull();
    expect(multiplyMatrices(layerToDocument, path!.transform)).toEqual(placement!.pathToDocument);
  });

  it('restores the exact opening snapshot on cancel', () => {
    const state = setup();
    state.controller.createLayer([createVectorPath('path')]);
    const opening = state.document;
    const layerId = opening.activeLayerId!;
    state.controller.beginPathMutation(layerId, 'path');
    state.controller.previewPathMutation((path) => translateVectorPath(path, { x: 9, y: 4 }));

    expect(state.controller.cancelPathMutation()).toBe(true);
    expect(state.document).toBe(opening);
  });

  it('does not commit an interaction into another active document', () => {
    const state = setup();
    state.controller.createLayer([createVectorPath('path')]);
    state.history.length = 0;
    state.controller.beginPathMutation(state.document.activeLayerId!, 'path');
    state.replaceDocument(createImageDocument('Other', 20, 20, 'other'));

    expect(state.controller.previewPathMutation((path) => translateVectorPath(path, { x: 1, y: 1 })))
      .toBe(false);
    expect(state.history).toHaveLength(0);
  });
});
