import { describe, expect, it, vi } from 'vitest';
import {
  createVectorPath,
  translateVectorPath
} from '@lighttable/vector-core';
import { createImageDocument } from '../../editor/document/documentTypes';
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
    expect(layer.paths[0]?.transform).toMatchObject({ tx: 7, ty: 3 });
  });

  it('constructs a new path as one document transaction', () => {
    const state = setup();
    const opening = state.document;
    const path = createVectorPath('pen-path');

    const layerId = state.controller.beginPathCreation(path);
    expect(layerId).not.toBeNull();
    expect(state.history).toHaveLength(0);

    const preview = translateVectorPath(path, { x: 12, y: 5 });
    expect(state.controller.previewPathCreation(preview)).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.commitPathCreation()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.before).toBe(opening);

    const layer = findDocumentLayer(state.document, layerId!);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.paths[0]?.transform).toMatchObject({ tx: 12, ty: 5 });
  });

  it('appends a provisional path to an editable active vector layer', () => {
    const state = setup();
    state.controller.createLayer([createVectorPath('existing')]);
    const layerId = state.document.activeLayerId!;
    state.history.length = 0;

    expect(state.controller.beginPathCreation(createVectorPath('new'))).toBe(layerId);
    const layer = findDocumentLayer(state.document, layerId);
    expect(layer?.type === 'vector' ? layer.paths.map(({ id }) => id) : []).toEqual([
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
