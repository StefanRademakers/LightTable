import { afterEach, expect, it, vi } from 'vitest';
import { createPositionedTextFixture } from '@lighttable/text-core';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { PositionedTextRecoveryCommandController } from './PositionedTextRecoveryCommandController';
import { PositionedTextRecoveryIntent } from './PositionedTextRecoveryIntent';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const fixture = () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  sessions.push(session);
  const text = createPositionedTextFixture();
  if (text.source.kind !== 'positioned') throw new Error('Expected positioned fixture.');
  session.setDocument(createTextLayer(createImageDocument('Recovery', 100, 50, 'asset'),
    { ...text, source: { ...text.source, editability: 'recoverable' } }, 'Imported'));
  session.setReady(); const opening = session.getSnapshot().document!, layerId = opening.activeLayerId!;
  let current = true, blocked = false, failHistory = false;
  const history: DocumentMutationHistoryEntry[] = [];
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: document => session.setDocument(document), previewSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushHistoryEntry: entry => { if (failHistory) throw new Error('History rejected'); history.push(entry); },
    isMutationBlocked: () => blocked }));
  const command = new PositionedTextRecoveryCommandController(() => ({ getDocument: () => session.getSnapshot().document, documentMutations: mutations }));
  const ports = { isCurrent: () => current, getDocument: () => session.getSnapshot().document,
    captureScope: () => ({ isCurrent: () => current }), text: { finishBeforeTransition: vi.fn(() => true) },
    command, status: vi.fn(), error: vi.fn() };
  const owner = new PositionedTextRecoveryIntent(ports);
  return { session, opening, layerId, history, ports, owner, offer: owner.offer(layerId)!,
    retire: () => { current = false; }, block: () => { blocked = true; }, fail: () => { failHistory = true; } };
};
it('offers without mutation and reports its own committed recovery despite replaced source; undo restores exact glyphs', () => {
  const f = fixture(); expect(f.session.getSnapshot().document).toBe(f.opening);
  expect(f.offer.analysis.preview?.source.text).toBe('A');
  expect(f.offer.onRecover()).toBe(true); expect(f.history).toHaveLength(1); expect(f.ports.status).toHaveBeenCalledOnce();
  expect(f.ports.error).not.toHaveBeenCalled(); const recovered = f.session.getSnapshot().document;
  f.history[0].undo(); expect(f.session.getSnapshot().document).toBe(f.opening);
  f.history[0].redo(); expect(f.session.getSnapshot().document).toBe(recovered);
});
it.each(['changed-source', 'active-target', 'terminal-source'] as const)('rejects the obsolete offered %s without mutation', mode => {
  const f = fixture();
  const replace = () => {
    const current = f.session.getSnapshot().document!;
    if (mode === 'active-target') f.session.setDocument({ ...current, activeLayerId: current.layers[0].id });
    else f.session.setDocument({ ...current, layers: current.layers.map(layer => layer.id === f.layerId && layer.type === 'text'
      ? { ...layer, text: { ...layer.text, source: { ...layer.text.source } } } : layer) });
  };
  if (mode === 'terminal-source') vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(() => { replace(); return true; });
  else replace();
  expect(f.offer.onRecover()).toBe(false); expect(f.history).toHaveLength(0); expect(f.ports.error).toHaveBeenCalledOnce();
});
it.each(['retired', 'terminal-retired'] as const)('suppresses %s work and feedback', mode => {
  const f = fixture(); if (mode === 'retired') f.retire();
  else vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(() => { f.retire(); return true; });
  expect(f.offer.onRecover()).toBe(false); expect(f.history).toHaveLength(0);
  expect(f.ports.error).not.toHaveBeenCalled(); expect(f.ports.status).not.toHaveBeenCalled();
});
it.each(['terminal-rejected', 'blocked', 'history-failed'] as const)('reports genuine %s once without success', mode => {
  const f = fixture(); if (mode === 'terminal-rejected') vi.mocked(f.ports.text.finishBeforeTransition).mockReturnValue(false);
  if (mode === 'blocked') f.block(); if (mode === 'history-failed') f.fail();
  expect(f.offer.onRecover()).toBe(false); expect(f.history).toHaveLength(0);
  expect(f.ports.error).toHaveBeenCalledOnce(); expect(f.ports.status).not.toHaveBeenCalled();
  expect(findDocumentLayer(f.session.getSnapshot().document!, f.layerId)).toMatchObject({ text: { source: { kind: 'positioned' } } });
});
