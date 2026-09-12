import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createGradientFillLayer, createGroupLayer } from '../../editor/document/documentCommands';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { applyLayerCreation } from './applyLayerCreation';

describe('admitted layer creation result', () => {
  it('returns the authored ID even when an observer changes selection before mutate returns', () => {
    let document = createImageDocument('Image', 20, 10, 'image'); const opening = document.activeLayerId;
    const history: unknown[] = [];
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      applySnapshot: next => { document = next; }, previewSnapshot: () => undefined, discardPreview: () => undefined,
      pushHistoryEntry: entry => { history.push(entry); }
    }));
    const layerId = applyLayerCreation(change => {
      const changed = mutations.change(change); document = { ...document, activeLayerId: opening }; return changed;
    }, createGradientFillLayer);
    expect(layerId).not.toBeNull(); expect(layerId).not.toBe(document.activeLayerId);
    expect(document.layers.some(layer => layer.id === layerId)).toBe(true); expect(history).toHaveLength(1);
  });
  it('never returns a candidate ID from a rejected mutation', () => {
    const document = createImageDocument('Image', 20, 10, 'image');
    expect(applyLayerCreation(change => { change(document); return false; }, createGroupLayer)).toBeNull();
  });
  it('returns null for unchanged creation without adding history', () => {
    const document = createImageDocument('Image', 20, 10, 'image');
    expect(applyLayerCreation(change => change(document) !== document, current => current)).toBeNull();
  });
});
