import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { DocumentSession, type DocumentSessionId } from './documentSession';

describe('DocumentSession publication transaction', () => {
  it('notifies external-store subscribers only after matching open state is complete', () => {
    const session = new DocumentSession({
      id: 'document-1' as DocumentSessionId,
      source: { id: 'source-1', name: 'old.png', mediaType: 'image/png' }
    });
    const observed = vi.fn(() => {
      const snapshot = session.getSnapshot();
      expect(snapshot.document?.name).toBe('new.png');
      expect(snapshot.loadedSource.metadata?.name).toBe('new.png');
      expect(snapshot.loadedSource.identity).toBe('new-source');
      expect(snapshot.processing.adjustments.exposureEV).toBe(1);
    });
    session.subscribe(observed);
    const document = createImageDocument('new.png', 4, 4, 'asset');

    session.runPublication(() => {
      session.setDocument(document);
      session.updateLoadedSource((current) => ({
        ...current,
        metadata: { name: 'new.png', width: 4, height: 4, contentType: 'image/png' },
        name: 'new.png',
        blob: new Blob(['pixels']),
        identity: 'new-source'
      }));
      session.updateProcessing((current) => ({
        ...current,
        adjustments: { ...current.adjustments, exposureEV: 1 }
      }));
    });

    expect(observed).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('flushes the latest valid snapshot when publication throws', () => {
    const session = new DocumentSession({
      id: 'document-2' as DocumentSessionId,
      source: { id: 'source-2', name: 'image.png', mediaType: 'image/png' }
    });
    const observed = vi.fn();
    session.subscribe(observed);

    expect(() => session.runPublication(() => {
      session.setTitle('Published title');
      throw new Error('publication failed');
    })).toThrow('publication failed');

    expect(observed).toHaveBeenCalledOnce();
    expect(session.getSnapshot().title).toBe('Published title');
    session.dispose();
  });

  it('does not publish when a conditional editor update loses its revision race', () => {
    const session = new DocumentSession({
      id: 'document-3' as DocumentSessionId,
      source: { id: 'source-3', name: 'image.png', mediaType: 'image/png' }
    });
    session.setReady();
    const observed = vi.fn();
    session.subscribe(observed);

    expect(session.updateEditorIf(
      (current) => current.selectionRevision === 7,
      (current) => ({ ...current, selectionRevision: 8 })
    )).toBe(false);

    expect(session.getSnapshot().editor.selectionRevision).toBe(0);
    expect(observed).not.toHaveBeenCalled();
    session.dispose();
  });

  it('pins revision and dirty state while a close transition owns mutation admission', async () => {
    const session = new DocumentSession({
      id: 'document-4' as DocumentSessionId,
      source: { id: 'source-4', name: 'image.png', mediaType: 'image/png' }
    });
    session.setReady();
    session.markChanged();

    const admission = session.acquireMutationAdmission('Document is closing.');
    expect(admission).toMatchObject({ revision: 1, dirty: true });
    expect(() => session.markChanged()).toThrow('Document is closing.');
    expect(() => session.history.record({
      id: 'raced-command',
      type: 'test',
      label: 'Raced command',
      documentId: session.id,
      undo: () => undefined,
      redo: () => undefined
    })).toThrow(/not accepting mutations/i);
    const racedTask = vi.fn(async () => true);
    expect(session.isAcceptingMutations()).toBe(false);

    await expect(session.tasks.run('save', 'Raced save', racedTask)).resolves.toMatchObject({
      status: 'failed',
      error: { message: 'Document is closing.' }
    });
    expect(racedTask).not.toHaveBeenCalled();
    admission.release();
    expect(session.isAcceptingMutations()).toBe(true);
    expect(() => session.markChanged()).not.toThrow();
    expect(session.getSnapshot().documentRevision).toBe(2);
    session.dispose();
  });
});
