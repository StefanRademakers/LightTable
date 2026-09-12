import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { DocumentSession, type DocumentSessionId } from './documentSession';
import { createDocumentMutationController } from './useDocumentMutationController';

const createSession = () => new DocumentSession({
  id: 'revision-document' as DocumentSessionId,
  source: { id: 'source', name: 'image.png', mediaType: 'image/png' }
});
const record = (session: DocumentSession, id: string, affectsDocument = true) => session.history.record({
  id, type: 'test', label: id, documentId: session.id, affectsDocument,
  undo: () => undefined, redo: () => undefined
});

describe('DocumentSession canonical revision authority', () => {
  it('invalidates the native UI mutation route on commit and undo, never on renderer-only preview', async () => {
    const session = createSession();
    session.setDocument(createImageDocument('image.png', 4, 4, 'source'));
    session.markSaved();
    const mutation = createDocumentMutationController(() => ({
      getDocument: () => session.getSnapshot().document,
      applySnapshot: document => session.setDocument(document),
      previewSnapshot: vi.fn(), discardPreview: vi.fn(),
      pushHistoryEntry: entry => { session.history.record({ ...entry, id: 'native-edit',
        documentId: session.id, type: 'face-warp', label: 'Face Warp' }); }
    }));
    const openingRevision = session.getSnapshot().documentRevision;
    const edit = mutation.begin('face-warp');
    expect(edit).not.toBeNull();
    edit!.change(document => ({ ...document, layers: document.layers.map(layer => ({ ...layer, opacity: 0.5 })) }));
    expect(session.getSnapshot().documentRevision).toBe(openingRevision);
    expect(edit!.commit()).toBe(true);
    const committedRevision = session.getSnapshot().documentRevision;
    expect(committedRevision).toBeGreaterThan(openingRevision);
    expect(session.getSnapshot().dirty).toBe(true);
    await session.history.undo();
    expect(session.getSnapshot().documentRevision).toBeGreaterThan(committedRevision);
    expect(session.getSnapshot().dirty).toBe(false);
  });

  it('publishes changed canonical fields and their stamp in the same snapshot, without dirtying hydration', () => {
    const session = createSession();
    const document = createImageDocument('image.png', 4, 4, 'source');
    const observed: number[] = [];
    session.subscribe(() => {
      expect(session.getSnapshot().document).toBe(document);
      observed.push(session.getSnapshot().documentRevision);
    });
    session.setDocument(document);
    expect(observed).toEqual([1]);
    expect(session.getSnapshot().dirty).toBe(false);
    session.setDocument(document);
    expect(observed).toEqual([1]);
  });

  it('compensates a rejected native transaction without rewinding the public revision', () => {
    const session = createSession();
    const original = createImageDocument('image.png', 4, 4, 'source');
    session.setDocument(original);
    session.markSaved();
    const revisions: number[] = [];
    session.subscribe(() => revisions.push(session.getSnapshot().documentRevision));
    const mutation = createDocumentMutationController(() => ({
      getDocument: () => session.getSnapshot().document,
      applySnapshot: document => session.setDocument(document),
      previewSnapshot: vi.fn(), discardPreview: vi.fn(),
      pushHistoryEntry: () => { throw new Error('History rejected publication.'); }
    }));
    expect(() => mutation.change(document => ({ ...document, name: 'Rejected' })))
      .toThrow('History rejected publication.');
    expect(session.getSnapshot().document).toBe(original);
    expect(session.getSnapshot().dirty).toBe(false);
    expect(revisions).toEqual([2, 3]);
  });

  it('does not invalidate for active-layer, vector-handle, viewport or channel chrome', () => {
    const session = createSession();
    const document = createImageDocument('image.png', 4, 4, 'source');
    session.setDocument(document);
    const revision = session.getSnapshot().documentRevision;
    session.setDocument({ ...document, activeLayerId: null, revision: document.revision + 1, modifiedAt: Date.now() });
    session.updateEditor(current => ({ ...current, activeChannel: 'mask', vectorSelection: { ...current.vectorSelection } }));
    session.updateViewport(current => ({ ...current, panX: 12 }));
    expect(session.getSnapshot().documentRevision).toBe(revision);
    expect(session.getSnapshot().dirty).toBe(false);
  });

  it('coalesces only an owned synchronous publication, including nested history acceptance', () => {
    const session = createSession();
    const observed = vi.fn();
    session.subscribe(observed);
    session.runPublication(() => {
      session.setDocument(createImageDocument('image.png', 4, 4, 'source'));
      session.runPublication(() => session.publishProcessing({ globalGradeStrength: 50 }));
      record(session, 'authored edit');
    });
    expect(observed).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 1, dirty: true });
    session.runPublication(() => session.publishProcessing({ globalGradeStrength: 75 }));
    expect(session.getSnapshot().documentRevision).toBe(2);
  });

  it('invalidates committed selection but not editor cloning or rejected conditional publication', () => {
    const session = createSession();
    session.updateEditor(current => ({ ...current }));
    expect(session.getSnapshot().documentRevision).toBe(0);
    session.updateEditor(current => ({ ...current, selectionRevision: 1,
      selectionMaskSnapshot: SelectionMaskSnapshot.inactive(4, 4) }));
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 1, dirty: false });
    expect(session.updateEditorIf(() => false, current => ({ ...current, selectionRevision: 2 }))).toBe(false);
    expect(session.getSnapshot().documentRevision).toBe(1);
  });

  it('stamps dimension and matching editor publication atomically once', () => {
    const session = createSession();
    session.setDocument(createImageDocument('image.png', 4, 4, 'source'));
    const document = { ...session.getSnapshot().document!, width: 8 };
    const observed = vi.fn(() => expect(session.getSnapshot()).toMatchObject({
      documentRevision: 2, document: { width: 8 }, editor: { selectionRevision: 1 }
    }));
    session.subscribe(observed);
    expect(session.updateDocumentAndEditorIf(() => true, document,
      current => ({ ...current, selectionRevision: 1 }))).toBe(true);
    expect(observed).toHaveBeenCalledOnce();
  });

  it('retains processing identity and revision for omitted or unchanged supplied fields', () => {
    const session = createSession();
    const before = session.getSnapshot();
    session.publishProcessing({});
    session.publishProcessing({ ...before.processing, groupVisibility: { ...before.processing.groupVisibility } });
    expect(session.getSnapshot()).toBe(before);
    session.publishProcessing({ adjustments: { ...before.processing.adjustments, exposureEV: 2 } });
    expect(session.getSnapshot().documentRevision).toBe(1);
    expect(session.getSnapshot().processing.groupVisibility).toBe(before.processing.groupVisibility);
  });

  it('invalidates pixel-only commit and replay while undo back to saved content becomes clean', async () => {
    const session = createSession();
    session.markSaved();
    record(session, 'GPU pixels');
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 1, dirty: true });
    await session.history.undo();
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 2, dirty: false });
    await session.history.redo();
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 3, dirty: true });
    session.markSaved();
    expect(session.getSnapshot()).toMatchObject({ savedRevision: 3, dirty: false });
    record(session, 'selection history', false);
    await session.history.undo();
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 3, dirty: false });
  });

  it('does not confuse an unrelated intervening revision with a later pixel-only edit', () => {
    const session = createSession();
    const openingRevision = session.getSnapshot().documentRevision;
    session.publishProcessing({ globalGradeStrength: 60 });
    record(session, 'GPU operation that awaited preparation');
    expect(session.getSnapshot().documentRevision).toBe(openingRevision + 2);
  });

  it('preserves explicit nonhistory dirty state across history replay until a current save', async () => {
    const session = createSession();
    session.markChanged();
    record(session, 'GPU pixels');
    await session.history.undo();
    expect(session.getSnapshot().dirty).toBe(true);
    session.markSaved();
    expect(session.getSnapshot().dirty).toBe(false);
  });

  it('invalidates history clearing without mistaking its new stamp for authored dirty state', () => {
    const session = createSession();
    record(session, 'GPU pixels');
    session.markSaved();
    session.history.clear();
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 2, dirty: false });
    session.setReady();
    session.setDocument(createImageDocument('rebound.png', 4, 4, 'source'));
    expect(session.getSnapshot()).toMatchObject({ documentRevision: 3, dirty: false });
  });

  it('does not erase explicit dirty ownership when history rejects a save acknowledgement', () => {
    const session = createSession();
    session.markChanged();
    const barrier = session.history.acquireAdmissionBarrier();
    expect(() => session.markSaved()).toThrow(/not accepting mutations/i);
    barrier.release();
    expect(session.getSnapshot().dirty).toBe(true);
  });

  it('never marks a newer history position or nonhistory edit saved for a stale save capture', () => {
    const session = createSession();
    session.markSaved();
    const capturedRevision = session.getSnapshot().documentRevision;
    record(session, 'intervening pixels');
    session.markChanged();
    const current = session.getSnapshot();
    session.markSaved(capturedRevision);
    expect(session.getSnapshot()).toBe(current);
    expect(session.getSnapshot()).toMatchObject({ savedRevision: 0, dirty: true });
    expect(session.getSnapshot().history.dirty).toBe(true);
    expect(() => session.markSaved(current.documentRevision + 1)).toThrow('newer than the document');
  });
});
