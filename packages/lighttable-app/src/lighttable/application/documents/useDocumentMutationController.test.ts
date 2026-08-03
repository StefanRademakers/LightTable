import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer, deleteLayer } from '../../editor/document/documentCommands';
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
  const applySnapshot = vi.fn((next: ImageDocument) => {
    document = next;
  });
  const dependencies: DocumentMutationDependencies = {
    getDocument: () => document,
    applySnapshot,
    pushHistoryEntry: (entry) => history.push(entry)
  };
  const controller = createDocumentMutationController(() => dependencies);
  return {
    controller,
    history,
    applySnapshot,
    get document() { return document; },
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

  it('coalesces repeated previews into one transaction', () => {
    const state = setup();
    state.controller.begin();
    state.controller.change((current) => renamed(current, 'One'));
    state.controller.change((current) => renamed(current, 'Two'));
    state.controller.change((current) => renamed(current, 'Three'));
    expect(state.history).toHaveLength(0);
    expect(state.controller.end()).toBe(true);
    expect(state.history).toHaveLength(1);
    state.history[0].undo();
    expect(state.document?.name).toBe('First');
  });

  it('rejects completion after the active document changes', () => {
    const state = setup();
    state.controller.begin();
    state.setDocument(createImageDocument('Second', 32, 24, 'second'));
    expect(state.controller.end()).toBe(false);
    expect(state.history).toHaveLength(0);
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
