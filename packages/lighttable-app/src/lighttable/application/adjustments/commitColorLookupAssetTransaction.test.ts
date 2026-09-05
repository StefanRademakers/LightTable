import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentAssetId } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import {
  commitColorLookupAssetTransaction,
  type ColorLookupRuntimePort
} from './commitColorLookupAssetTransaction';
import type { AdjustmentProjection } from './projectAdjustmentSnapshot';

const assetId = 'lut-imported' as DocumentAssetId;

const setup = (rejectHistory = false) => {
  const beforeDocument = createImageDocument('Fixture', 16, 9, 'fixture');
  let document = beforeDocument;
  let editorAdjustments = createDefaultAdjustments();
  let documentAdjustments = createDefaultAdjustments();
  const runtime: ColorLookupRuntimePort = {
    loadColorLookupAsset: vi.fn(async () => undefined),
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
    ...editorAdjustments,
    gradeLook: { ...editorAdjustments.gradeLook, assetId }
  };
  const applyProjection = vi.fn((projection: AdjustmentProjection) => {
    if (projection.document) document = projection.document;
    editorAdjustments = projection.editorAdjustments;
    documentAdjustments = projection.documentAdjustments;
  });
  const entries: EditorHistoryEntry[] = [];
  return {
    beforeDocument,
    beforeEditorAdjustments: editorAdjustments,
    beforeDocumentAdjustments: documentAdjustments,
    nextAdjustments,
    transaction,
    runtime,
    applyProjection,
    entries,
    execute: () => commitColorLookupAssetTransaction({
      transaction,
      runtime,
      source: new Blob(['LUT']),
      assetId,
      beforeDocument,
      beforeEditorAdjustments: editorAdjustments,
      beforeDocumentAdjustments: documentAdjustments,
      nextEditorAdjustments: nextAdjustments,
      targetLayerId: null,
      history: { type: 'adjustment.grade.paste', label: 'Paste Grade' },
      originIsCurrent: () => document === beforeDocument,
      documentIsActive: (documentId) => document.id === documentId,
      applyProjection,
      pushHistoryEntry: (entry) => {
        if (rejectHistory) throw new Error('History rejected the import.');
        entries.push(entry);
      }
    }),
    getDocument: () => document,
    getEditorAdjustments: () => editorAdjustments,
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
});
