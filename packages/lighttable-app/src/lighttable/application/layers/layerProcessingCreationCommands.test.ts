import { afterEach, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createLayerProcessingCreationCommands } from './layerProcessingCreationCommands';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const fixture = () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  sessions.push(session); session.setDocument(createImageDocument('A', 100, 50, 'asset')); session.setReady();
  const history: DocumentMutationHistoryEntry[] = [];
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: document => session.setDocument(document), previewSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushHistoryEntry: entry => { history.push(entry); } }));
  const feedback = { isCurrent: () => true, setActiveChannel: vi.fn(), setError: vi.fn(), setStatus: vi.fn() };
  const ports = { beginTransaction: mutations.begin,
    commitTransaction: (transaction: Parameters<Parameters<typeof createLayerProcessingCreationCommands>[0]['commitTransaction']>[0],
      document: NonNullable<ReturnType<typeof session.getSnapshot>['document']>) => {
      transaction.stage(() => document); return transaction.commit();
    }, captureFeedback: () => feedback };
  return { session, history, ports, feedback, create: () => createLayerProcessingCreationCommands(ports) };
};
it('returns the actual committed standalone ID rather than a later active layer or success flag', () => {
  const f = fixture(), original = f.session.getSnapshot().document!.activeLayerId!;
  const commit = f.ports.commitTransaction;
  f.ports.commitTransaction = (transaction, next) => {
    const accepted = commit(transaction, next);
    f.session.setDocument({ ...f.session.getSnapshot().document!, activeLayerId: original });
    return accepted;
  };
  const created = f.create().create('curves');
  const document = f.session.getSnapshot().document!, actual = document.layers.find(layer => layer.type === 'adjustment')!;
  expect(created).toBe(actual.id); expect(created).not.toBe(document.activeLayerId); expect(f.history).toHaveLength(1);
  f.history[0].undo(); expect(f.session.getSnapshot().document!.layers).toHaveLength(1);
  f.history[0].redo(); expect(f.session.getSnapshot().document!.layers.at(-1)!.id).toBe(created);
});
