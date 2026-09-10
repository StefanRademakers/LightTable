import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentAssetId } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import {
  commitColorLookupAssetTransaction,
  type ColorLookupCanonicalProjection,
  type ColorLookupRuntimePort
} from './commitColorLookupAssetTransaction';

const assetId = 'lut-imported' as DocumentAssetId;

const setup = (rejectHistory = false, invalidateDuringLoad = false) => {
  const beforeDocument = createImageDocument('Fixture', 16, 9, 'fixture');
  let document = beforeDocument;
  let documentAdjustments = createDefaultAdjustments();
  let bindingCurrent = true;
  const runtime: ColorLookupRuntimePort = {
    loadColorLookupAsset: vi.fn(async () => {
      if (invalidateDuringLoad) bindingCurrent = false;
    }),
    removeColorLookupAsset: vi.fn(() => true)
  };
  const controller = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; },
    previewSnapshot: vi.fn(),
    discardPreview: vi.fn(),
    pushHistoryEntry: vi.fn()
  }));
  const transaction = controller.begin('lut-import', undefined, undefined, 'cancel');
  if (!transaction) throw new Error('Expected a document transaction.');
  const withAsset = {
    ...beforeDocument,
    assets: {
      ...beforeDocument.assets,
      colorLookups: [{
        id: assetId,
        name: 'Imported',
        size: 2,
        domainMin: [0, 0, 0] as [number, number, number],
        domainMax: [1, 1, 1] as [number, number, number],
        byteLength: 16,
        revision: 0
      }]
    },
    revision: beforeDocument.revision + 1
  };
  transaction.stage(() => withAsset);
  const nextAdjustments = {
    ...documentAdjustments,
    gradeLook: { ...documentAdjustments.gradeLook, assetId }
  };
  const applyCanonicalProjection = vi.fn((projection: ColorLookupCanonicalProjection) => {
    if (projection.document) document = projection.document;
    documentAdjustments = projection.documentAdjustments;
  });
  const entries: EditorHistoryEntry[] = [];
  return {
    beforeDocument,
    beforeDocumentAdjustments: documentAdjustments,
    nextAdjustments,
    transaction,
    runtime,
    applyCanonicalProjection,
    entries,
    execute: () => commitColorLookupAssetTransaction({
      transaction,
      runtime,
      source: new Blob(['LUT']),
      assetId,
      beforeDocument,
      beforeDocumentAdjustments: documentAdjustments,
      nextEditorAdjustments: nextAdjustments,
      targetLayerId: null,
      history: { type: 'adjustment.grade.paste', label: 'Paste Grade' },
      bindingIsCurrent: () => bindingCurrent && document === beforeDocument,
      documentIsActive: (documentId) => document.id === documentId,
      applyCanonicalProjection,
      pushHistoryEntry: (entry) => {
        if (rejectHistory) throw new Error('History rejected the import.');
        entries.push(entry);
      }
    }),
    getDocument: () => document,
    getDocumentAdjustments: () => documentAdjustments
  };
};

describe('commitColorLookupAssetTransaction', () => {
  it('commits runtime, metadata, Grade state and history as one operation', async () => {
    const state = setup();

    await state.execute();

    expect(state.runtime.loadColorLookupAsset).toHaveBeenCalledWith(
      state.beforeDocument.id,
      expect.objectContaining({ lutId: assetId })
    );
    expect(state.getDocument().assets.colorLookups).toHaveLength(1);
    expect(state.getDocumentAdjustments().gradeLook.assetId).toBe(assetId);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].resourceIds).toEqual([assetId]);

    await state.entries[0].undo();
    expect(state.getDocument()).toBe(state.beforeDocument);
    expect(state.getDocumentAdjustments().gradeLook.assetId).toBeNull();

    await state.entries[0].redo();
    expect(state.getDocument().assets.colorLookups).toHaveLength(1);
    expect(state.getDocumentAdjustments().gradeLook.assetId).toBe(assetId);
  });

  it('rolls document, Grade and runtime back when history rejects the operation', async () => {
    const state = setup(true);

    await expect(state.execute()).rejects.toThrow('History rejected the import.');

    expect(state.getDocument()).toBe(state.beforeDocument);
    expect(state.getDocumentAdjustments().gradeLook.assetId).toBeNull();
    expect(state.runtime.removeColorLookupAsset).toHaveBeenCalledWith(
      state.beforeDocument.id,
      assetId
    );
  });

  it('rejects and removes a loaded runtime when its renderer binding changes', async () => {
    const state = setup(false, true);

    await expect(state.execute()).rejects.toThrow('target changed');

    expect(state.getDocument()).toBe(state.beforeDocument);
    expect(state.entries).toHaveLength(0);
    expect(state.runtime.removeColorLookupAsset).toHaveBeenCalledWith(
      state.beforeDocument.id,
      assetId
    );
  });
});
