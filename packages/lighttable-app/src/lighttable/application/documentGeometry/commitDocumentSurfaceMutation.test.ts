import { describe, expect, it, vi } from 'vitest';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { commitDocumentSurfaceMutation } from './commitDocumentSurfaceMutation';

const documentSnapshot = (revision: number, width: number, height: number) => ({
  id: 'document-1',
  revision,
  width,
  height
}) as ImageDocument;

const setup = (rejectHistory = false) => {
  const before = documentSnapshot(0, 100, 80);
  const after = documentSnapshot(1, 200, 160);
  let currentDocument = before;
  let surfaceDocument = before;
  let runtimeState: 'before' | 'after' = 'before';
  const historyEntries: EditorHistoryEntry[] = [];
  const dispose = vi.fn();
  const controller = createDocumentMutationController(() => ({
    getDocument: () => currentDocument,
    applySnapshot: (document) => { currentDocument = document; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: () => undefined
  }));
  const transaction = controller.begin('image-size', undefined, undefined, 'cancel')!;
  const beforeMask = SelectionMaskSnapshot.inactive(before.width, before.height);
  const afterMask = SelectionMaskSnapshot.inactive(after.width, after.height);
  const commit = () => commitDocumentSurfaceMutation({
    transaction,
    afterDocument: after,
    beforeSelection: [],
    afterSelection: [],
    beforeSelectionMask: beforeMask,
    history: { type: 'document.image-size', label: 'Image Size' },
    originIsCurrent: () => currentDocument === before,
    captureSelectionSnapshot: async () => afterMask,
    restoreSelectionSnapshot: async () => true,
    createRuntimeMutation: () => {
      runtimeState = 'after';
      return {
        byteSize: 512,
        apply: (state) => { runtimeState = state; },
        dispose
      };
    },
    resizeDocumentSurface: (document) => { surfaceDocument = document; },
    publishDocumentSelection: (document) => { currentDocument = document; },
    pushHistoryEntry: (entry) => {
      if (rejectHistory) throw new Error('History rejected the entry.');
      historyEntries.push(entry);
    }
  });
  return {
    before,
    after,
    commit,
    dispose,
    historyEntries,
    get currentDocument() { return currentDocument; },
    get surfaceDocument() { return surfaceDocument; },
    get runtimeState() { return runtimeState; }
  };
};

describe('commitDocumentSurfaceMutation', () => {
  it('publishes runtime, document, selection and history as one reversible operation', async () => {
    const state = setup();

    await expect(state.commit()).resolves.toBe(true);
    expect(state.currentDocument).toBe(state.after);
    expect(state.surfaceDocument).toBe(state.after);
    expect(state.runtimeState).toBe('after');
    expect(state.historyEntries).toHaveLength(1);
    expect(state.historyEntries[0]!.byteSize).toBe(
      512
      + SelectionMaskSnapshot.inactive(state.before.width, state.before.height).byteSize
      + SelectionMaskSnapshot.inactive(state.after.width, state.after.height).byteSize
    );

    state.historyEntries[0]!.undo();
    expect(state.currentDocument).toBe(state.before);
    expect(state.surfaceDocument).toBe(state.before);
    expect(state.runtimeState).toBe('before');

    state.historyEntries[0]!.redo();
    expect(state.currentDocument).toBe(state.after);
    expect(state.surfaceDocument).toBe(state.after);
    expect(state.runtimeState).toBe('after');
  });

  it('restores and disposes prepared GPU state when history rejects the operation', async () => {
    const state = setup(true);

    await expect(state.commit()).rejects.toThrow('History rejected the entry.');
    expect(state.currentDocument).toBe(state.before);
    expect(state.surfaceDocument).toBe(state.before);
    expect(state.runtimeState).toBe('before');
    expect(state.dispose).toHaveBeenCalledOnce();
  });
});
