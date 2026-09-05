import { describe, expect, it, vi } from 'vitest';
import { createAdjustmentLayer, createGradientFillLayer, createRasterLayer, createVectorLayer, deleteLayer,
  replaceVectorPath } from '../../editor/document/documentCommands';
import { createVectorPath } from '@lighttable/vector-core';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import {
  createDocumentMutationController,
  type DocumentMutationDependencies,
  type DocumentMutationHistoryEntry
} from './useDocumentMutationController';

const renamed = (document: ImageDocument, name: string): ImageDocument => ({
  ...document,
  name
});

const setup = () => {
  let document: ImageDocument | null = createImageDocument('First', 32, 24, 'first');
  const history: DocumentMutationHistoryEntry[] = [];
  let preview: ImageDocument | null = null;
  const applySnapshot = vi.fn((next: ImageDocument) => {
    document = next;
  });
  const previewSnapshot = vi.fn((next: ImageDocument) => {
    preview = next;
  });
  const discardPreview = vi.fn(() => {
    preview = null;
  });
  const dependencies: DocumentMutationDependencies = {
    getDocument: () => document,
    applySnapshot,
    previewSnapshot,
    discardPreview,
    pushHistoryEntry: (entry) => history.push(entry)
  };
  const controller = createDocumentMutationController(() => dependencies);
  return {
    controller,
    history,
    applySnapshot,
    previewSnapshot,
    discardPreview,
    get document() { return document; },
    get preview() { return preview; },
    setDocument: (next: ImageDocument | null) => { document = next; }
  };
};

describe('document mutation controller', () => {
  it('records an immediate immutable document mutation', () => {
    const state = setup();
    state.controller.change((current) => renamed(current, 'Renamed'));
    expect(state.document?.name).toBe('Renamed');
    expect(state.history).toHaveLength(1);
    state.history[0].undo();
    expect(state.document?.name).toBe('First');
    state.history[0].redo();
    expect(state.document?.name).toBe('Renamed');
    expect(state.history[0].layerIds).toEqual([]);
    expect(state.history[0].byteSize).toBe(0);
  });

  it('accounts only raster resources detached by structural mutations', () => {
    const state = setup();
    state.controller.change((current) => createRasterLayer(current));
    const createdId = state.document?.activeLayerId;
    expect(createdId).toBeTruthy();
    expect(state.history[0].layerIds).toEqual([createdId]);
    expect(state.history[0].byteSize).toBe(32 * 24 * 8);

    state.controller.change((current) => deleteLayer(current, createdId!));
    expect(state.history[1].layerIds).toEqual([createdId]);
    expect(state.history[1].byteSize).toBe(32 * 24 * 8);
  });

  it('accounts canonical vector snapshots retained by history', () => {
    const state = setup();
    state.controller.change((current) => createVectorLayer(current, [createVectorPath('path')]));
    const layerId = state.document?.activeLayerId;
    const layer = state.document?.layers.find(({ id }) => id === layerId);
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    const path = layer.elements[0];
    if (path?.type !== 'path') throw new Error('Expected vector path.');

    state.controller.change((current) => replaceVectorPath(current, layer.id, {
      ...path,
      transform: { ...path.transform, tx: 4 },
      transformRevision: path.transformRevision + 1
    }));

    expect(state.history[0].byteSize).toBeGreaterThan(0);
    expect(state.history[1].byteSize).toBeGreaterThan(0);
    expect(state.history[1].layerIds).toEqual([]);
  });

  it('describes newly created semantic layer types', () => {
    const scenarios = [
      { mutate: createRasterLayer, label: 'New Pixel Layer' },
      { mutate: createVectorLayer, label: 'New Shape Layer' },
      { mutate: createGradientFillLayer, label: 'New Gradient Fill Layer' },
      {
        mutate: (document: ImageDocument) => createAdjustmentLayer(
          document, { id: 'levels-stack', revision: 0, modules: [] }, 'Levels', undefined, 'levels'
        ),
        label: 'New Levels Layer'
      }
    ] as const;
    scenarios.forEach(({ mutate, label }) => {
      const state = setup();
      state.controller.change(mutate);
      expect(state.history[0].label).toBe(label);
    });
  });

  it('coalesces repeated previews into one transaction', () => {
    const state = setup();
    const transaction = state.controller.begin('test.rename');
    transaction?.change((current) => renamed(current, 'One'));
    transaction?.change((current) => renamed(current, 'Two'));
    transaction?.change((current) => renamed(current, 'Three'));
    expect(state.document?.name).toBe('First');
    expect(state.preview?.name).toBe('Three');
    expect(state.applySnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
    expect(transaction?.commit()).toBe(true);
    expect(state.document?.name).toBe('Three');
    expect(state.applySnapshot).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(1);
    state.history[0].undo();
    expect(state.document?.name).toBe('First');
  });

  it('rejects completion after the active document changes', () => {
    const state = setup();
    const transaction = state.controller.begin('test.rename');
    state.setDocument(createImageDocument('Second', 32, 24, 'second'));
    expect(transaction?.commit()).toBe(false);
    expect(state.discardPreview).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(0);
  });

  it('cancels a staged preview without publishing document state', () => {
    const state = setup();
    const transaction = state.controller.begin('test.rename');
    transaction?.change((current) => renamed(current, 'Preview'));
    expect(transaction?.cancel()).toBe(true);
    expect(state.document?.name).toBe('First');
    expect(state.preview).toBeNull();
    expect(state.applySnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });

  it('keeps staged document intent owned by the transaction without replacing the renderer preview', () => {
    const state = setup();
    const transaction = state.controller.begin('test.renderer-optimized');
    expect(transaction?.stage((current) => renamed(current, 'Staged'))).toBe(true);
    expect(transaction?.current.name).toBe('Staged');
    expect(state.document?.name).toBe('First');
    expect(state.previewSnapshot).not.toHaveBeenCalled();
    expect(transaction?.commit()).toBe(true);
    expect(state.document?.name).toBe('Staged');
    expect(state.history).toHaveLength(1);
  });

  it('releases transaction-owned renderer state exactly once', () => {
    const state = setup();
    const onClose = vi.fn();
    const transaction = state.controller.begin('test.cleanup', undefined, onClose);
    transaction?.change((current) => renamed(current, 'Preview'));
    expect(transaction?.cancel()).toBe(true);
    expect(transaction?.cancel()).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hands a staged compound operation to its specialized committer without generic history', () => {
    const state = setup();
    const transaction = state.controller.begin('test.compound');
    transaction?.stage((current) => renamed(current, 'Compound'));
    const commit = vi.fn((before: ImageDocument, after: ImageDocument) => {
      expect(before.name).toBe('First');
      expect(after.name).toBe('Compound');
      return true;
    });
    expect(transaction?.commitWith(commit)).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(state.applySnapshot).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });

  it('finishes an active gesture before running an unrelated command', () => {
    const state = setup();
    const transaction = state.controller.begin('test.preview');
    transaction?.change((current) => renamed(current, 'Preview'));
    expect(state.controller.change((current) => renamed(current, 'Unrelated'))).toBe(true);
    expect(state.document?.name).toBe('Unrelated');
    expect(state.preview?.name).toBe('Preview');
    expect(state.history).toHaveLength(2);
    expect(transaction?.active).toBe(false);
  });

  it('prevents a stale owner from discarding a newer preview', () => {
    const state = setup();
    const first = state.controller.begin('first');
    first?.change((current) => renamed(current, 'First preview'));
    const second = state.controller.begin('second');
    second?.change((current) => renamed(current, 'Second preview'));

    expect(first?.cancel()).toBe(false);
    expect(first?.commit()).toBe(false);
    expect(state.preview?.name).toBe('Second preview');
    expect(state.controller.activeOwner).toBe('second');
  });

  it('refuses undo against a different active document', () => {
    const state = setup();
    state.controller.change((current) => renamed(current, 'Renamed'));
    state.setDocument(createImageDocument('Second', 32, 24, 'second'));
    expect(() => state.history[0].undo()).toThrow(
      'belongs to a different document'
    );
  });
});
