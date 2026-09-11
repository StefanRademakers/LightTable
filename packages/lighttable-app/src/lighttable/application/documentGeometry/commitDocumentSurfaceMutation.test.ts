import { describe, expect, it, vi } from 'vitest';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { commitDocumentSurfaceMutation } from './commitDocumentSurfaceMutation';

const documentSnapshot = (revision: number, width: number, height: number) => ({
  id: 'document-1',
  revision,
  width,
  height
}) as ImageDocument;

const setup = (
  rejectHistory = false,
  selectionActive = false,
  capturePause?: {
    readonly acquireAdmission: () => {
      run<Result>(operation: () => Result): Result;
      release(): void;
    };
    readonly started: () => void;
    readonly wait: Promise<void>;
    readonly pushHistoryEntry?: (entry: EditorHistoryEntry) => void;
  }
) => {
  const before = documentSnapshot(0, 100, 80);
  const after = documentSnapshot(1, 200, 160);
  let currentDocument = before;
  let surfaceDocument = before;
  let runtimeState: 'before' | 'after' = 'before';
  let originCurrent = true;
  let runtimeCurrent = true;
  let loseOriginAfterRestore = false;
  let loseRuntimeDuringCapture = false;
  let rejectNextPublication = false;
  const historyEntries: EditorHistoryEntry[] = [];
  const dispose = vi.fn();
  const disposeAfterOwnershipLoss = vi.fn();
  const apply = vi.fn((state: 'before' | 'after') => { runtimeState = state; });
  const controller = createDocumentMutationController(() => ({
    getDocument: () => currentDocument,
    applySnapshot: (document) => { currentDocument = document; },
    previewSnapshot: () => undefined,
    discardPreview: () => undefined,
    pushHistoryEntry: () => undefined
  }));
  const transaction = controller.begin('image-size', undefined, undefined, 'cancel')!;
  const beforeMask = selectionActive
    ? SelectionMaskSnapshot.fromRaw(before.width, before.height, new Uint16Array(before.width * before.height))
    : SelectionMaskSnapshot.inactive(before.width, before.height);
  const afterMask = selectionActive
    ? SelectionMaskSnapshot.fromRaw(after.width, after.height, new Uint16Array(after.width * after.height))
    : SelectionMaskSnapshot.inactive(after.width, after.height);
  const selection: readonly SelectionOperation[] = selectionActive ? [{
    mode: 'replace',
    shape: { kind: 'rectangle', points: [{ x: 250, y: 200 }, { x: 275, y: 225 }] }
  }] : [];
  const setAfterSelectionActive = vi.fn();
  const commit = () => commitDocumentSurfaceMutation({
    transaction,
    afterDocument: after,
    beforeSelection: selection,
    afterSelection: selection,
    beforeSelectionMask: beforeMask,
    history: { type: 'document.image-size', label: 'Image Size' },
    acquirePublicationAdmission: capturePause?.acquireAdmission ?? (() => ({
      run: <Result>(operation: () => Result) => operation(),
      release: () => undefined
    })),
    originIsCurrent: () => originCurrent && currentDocument === before,
    runtimeIsCurrent: () => runtimeCurrent,
    captureSelectionSnapshot: async () => {
      if (capturePause) {
        capturePause.started();
        await capturePause.wait;
      }
      if (loseRuntimeDuringCapture) {
        originCurrent = false;
        runtimeCurrent = false;
      }
      return afterMask;
    },
    restoreSelectionSnapshot: async () => {
      if (loseOriginAfterRestore) originCurrent = false;
      return true;
    },
    createRuntimeMutation: () => {
      runtimeState = 'after';
      return {
        resourceOwner: {},
        byteSize: 512,
        retainForHistory: vi.fn(),
        setAfterSelectionActive,
        apply,
        dispose,
        disposeAfterOwnershipLoss
      };
    },
    resizeDocumentSurface: (document) => { surfaceDocument = document; },
    publishHistoryState: async (_owner, publish) => publish(document => { surfaceDocument = document; }),
    publishDocumentSelection: (document) => {
      expect(surfaceDocument.width).toBe(document.width);
      currentDocument = document;
      if (rejectNextPublication) {
        rejectNextPublication = false;
        throw new Error('Editor projection failed after canonical publication.');
      }
    },
    pushHistoryEntry: (entry) => {
      if (rejectHistory) throw new Error('History rejected the entry.');
      capturePause?.pushHistoryEntry?.(entry);
      historyEntries.push(entry);
    }
  });
  return {
    before,
    after,
    commit,
    dispose,
    disposeAfterOwnershipLoss,
    apply,
    setAfterSelectionActive,
    historyEntries,
    get currentDocument() { return currentDocument; },
    get surfaceDocument() { return surfaceDocument; },
    get runtimeState() { return runtimeState; },
    loseOriginOnRestore() { loseOriginAfterRestore = true; },
    loseRendererDuringCapture() { loseRuntimeDuringCapture = true; },
    rejectNextPublication() { rejectNextPublication = true; }
  };
};

describe('commitDocumentSurfaceMutation', () => {
  it('preserves an active selection whose coverage is fully outside the resized canvas', async () => {
    const state = setup(false, true);

    await expect(state.commit()).resolves.toBe(true);
    expect(state.setAfterSelectionActive).toHaveBeenCalledOnce();
    expect(state.setAfterSelectionActive).toHaveBeenCalledWith(true);
    expect(state.historyEntries[0]!.byteSize).toBeGreaterThan(512);
  });

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

    await state.historyEntries[0]!.undo();
    expect(state.currentDocument).toBe(state.before);
    expect(state.surfaceDocument).toBe(state.before);
    expect(state.runtimeState).toBe('before');

    await state.historyEntries[0]!.redo();
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

  it('restores pixels and dimensions before canonical compensation after a failed undo publication', async () => {
    const state = setup(false, true);
    await state.commit();
    state.rejectNextPublication();
    await expect(state.historyEntries[0]!.undo()).rejects.toThrow('Editor projection failed');
    expect(state.currentDocument).toBe(state.after);
    expect(state.surfaceDocument).toBe(state.after);
    expect(state.runtimeState).toBe('after');
    await state.historyEntries[0]!.undo();
    expect(state.currentDocument).toBe(state.before);
    expect(state.runtimeState).toBe('before');
  });

  it('revalidates ownership after asynchronous selection restore and before the first GPU write', async () => {
    const state = setup();
    state.loseOriginOnRestore();

    await expect(state.commit()).rejects.toThrow(/lost its document or selection ownership/i);
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.surfaceDocument).toBe(state.before);
    expect(state.dispose).not.toHaveBeenCalled();
    expect(state.disposeAfterOwnershipLoss).not.toHaveBeenCalled();
  });

  it('retires detached prepared resources without addressing a replacement renderer generation', async () => {
    const state = setup();
    state.loseRendererDuringCapture();

    await expect(state.commit()).rejects.toThrow(/lost its document or selection ownership/i);
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.dispose).not.toHaveBeenCalled();
    expect(state.disposeAfterOwnershipLoss).toHaveBeenCalledOnce();
    expect(state.currentDocument).toBe(state.before);
  });

  it('holds document publication admission while the final GPU selection capture is pending', async () => {
    const session = new DocumentSession({
      id: 'geometry-document' as DocumentSessionId,
      source: { id: 'geometry-source', name: 'geometry.png', mediaType: 'image/png' }
    });
    session.setReady();
    let markCaptureStarted!: () => void;
    const captureStarted = new Promise<void>((resolve) => { markCaptureStarted = resolve; });
    let resumeCapture!: () => void;
    const captureWait = new Promise<void>((resolve) => { resumeCapture = resolve; });
    const state = setup(false, false, {
      acquireAdmission: () => session.acquirePublicationAdmission('Image Size is pending.'),
      started: markCaptureStarted,
      wait: captureWait,
      pushHistoryEntry: (entry) => session.history.record({
        id: 'geometry-history',
        type: entry.type ?? 'document.image-size',
        label: entry.label ?? 'Image Size',
        documentId: session.id,
        undo: entry.undo,
        redo: entry.redo,
        dispose: entry.dispose
      })
    });

    const committing = state.commit();
    await captureStarted;
    expect(() => session.runPublication(() => session.setTitle('Raced selection publication')))
      .toThrow('Image Size is pending.');
    resumeCapture();
    await expect(committing).resolves.toBe(true);
    expect(state.currentDocument).toBe(state.after);
    expect(state.surfaceDocument).toBe(state.after);
    expect(state.runtimeState).toBe('after');
    expect(session.history.getSnapshot().undoDepth).toBe(1);
    expect(session.isAcceptingMutations()).toBe(true);
    session.dispose();
  });
});
