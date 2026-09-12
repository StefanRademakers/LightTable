import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import { executeSemanticGradePatch } from './executeSemanticGradePatch';
import { executeSemanticAdjustmentSnapshot } from './executeSemanticAdjustmentSnapshot';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const fixture = () => {
  const session = new DocumentSession({ id: 'source' as DocumentSessionId,
    source: { id: 'image', name: 'Image', mediaType: 'image/png' } });
  sessions.push(session); session.setDocument(createImageDocument('Image', 20, 20, 'pixels')); session.setReady();
  const publish = vi.fn((adjustments: BasicAdjustments) => session.publishProcessing({ adjustments }));
  let sequence = 0;
  const history = (entry: { type: string; label: string; undo(): void; redo(): void }) =>
    session.history.record({ ...entry, id: `grade-${++sequence}`, documentId: session.id });
  const execute = (kind: 'grade' | 'snapshot', changed = true) => {
    const state = session.getSnapshot(), adjustments = state.processing.adjustments;
    const options = { document: state.document!, documentAdjustments: adjustments,
      assertMutationAllowed: () => { if (!session.isAcceptingMutations()) throw new Error('Document mutations are blocked.'); },
      changeDocument: vi.fn(), publishDocumentProcessing: publish, pushProcessingHistoryEntry: history };
    return kind === 'grade' ? executeSemanticGradePatch({ ...options,
      target: { kind: 'document' }, values: { exposureEV: changed ? 2 : adjustments.exposureEV },
      historyType: 'adjustment.basic', historyLabel: 'Set Basic Grade',
      mutate: (snapshot, values) => Object.assign(snapshot, values) })
      : executeSemanticAdjustmentSnapshot({ ...options, target: { kind: 'document', owner: 'grade' },
        snapshot: { ...cloneAdjustments(adjustments), exposureEV: changed ? 2 : adjustments.exposureEV } });
  };
  return { session, publish, execute };
};

describe('semantic document processing admission', () => {
  it.each(['grade', 'snapshot'] as const)('%s rejects a real history reservation before publishing', kind => {
    const f = fixture(), reservation = f.session.history.reserve({ id: 'held', documentId: f.session.id,
      type: 'held', label: 'Held', undo() {}, redo() {} });
    const before = f.session.getSnapshot();
    expect(() => f.execute(kind)).toThrow();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().processing).toBe(before.processing);
    expect(f.session.getSnapshot().documentRevision).toBe(before.documentRevision);
    expect(f.execute(kind, false).changed).toBe(false);
    reservation.cancel();
  });
  it.each(['grade', 'snapshot'] as const)('%s rejects while actual undo is pending without contaminating replay', async kind => {
    const f = fixture(); let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    f.session.history.record({ id: 'pending-undo', documentId: f.session.id,
      type: 'held', label: 'Held', undo: () => wait, redo() {} });
    const undo = f.session.history.undo();
    expect(f.session.history.getSnapshot().busy).toBe(true);
    const before = f.session.getSnapshot();
    expect(() => f.execute(kind)).toThrow();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().processing).toBe(before.processing);
    expect(f.session.getSnapshot().documentRevision).toBe(before.documentRevision);
    expect(f.execute(kind, false).changed).toBe(false);
    release(); await undo;
  });
  it.each(['grade', 'snapshot'] as const)('%s retains legitimate processing undo/redo through busy history', async kind => {
    const f = fixture(); expect(f.execute(kind).changed).toBe(true);
    const states: boolean[] = [];
    f.publish.mockImplementation(value => {
      states.push(f.session.history.getSnapshot().busy); f.session.publishProcessing({ adjustments: value });
    });
    await f.session.history.undo(); expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(0);
    await f.session.history.redo(); expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(2);
    expect(states).toEqual([true, true]);
  });
});
