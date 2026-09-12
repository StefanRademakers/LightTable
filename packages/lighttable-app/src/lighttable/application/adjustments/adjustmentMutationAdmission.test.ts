import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createAdjustmentTransactionController } from './useAdjustmentTransactionController';
import { createAdjustmentInteractionCoordinator } from './AdjustmentInteractionCoordinator';
import type { BasicAdjustments } from '../../types';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const setup = () => {
  const session = new DocumentSession({ id: 'admission' as DocumentSessionId,
    source: { id: 'source', name: 'source.png', mediaType: 'image/png' } });
  sessions.push(session);
  session.setDocument(createImageDocument('Source', 10, 10, 'source'));
  session.setReady();
  const canonical = () => session.getSnapshot().processing.adjustments;
  let projected = canonical();
  const isMutationBlocked = () => !session.isAcceptingMutations();
  const renderer = { setScopeInteractionActive: vi.fn(), setLensBlurInteractionActive: vi.fn() };
  const preview = vi.fn((next: BasicAdjustments) => { projected = next; });
  const replayBusy: boolean[] = [];
  const commit = vi.fn((next: BasicAdjustments) => {
    replayBusy.push(session.history.getSnapshot().busy);
    session.publishProcessing({ adjustments: next }); projected = canonical();
  });
  const observe = vi.fn();
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document!, applySnapshot: next => session.setDocument(next),
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: vi.fn(), isMutationBlocked
  }));
  const controller = createAdjustmentTransactionController(() => ({
    getDocumentId: () => session.getSnapshot().document!.id,
    getDocument: () => session.getSnapshot().document,
    getDocumentAdjustments: canonical, getCanonicalAdjustments: canonical,
    getActiveTargetLayerId: () => null, getActiveTargetIdentity: () => 'document:grade',
    getRenderer: () => renderer, getRendererGeneration: () => 1, isMutationBlocked,
    documentMutations: mutations, previewDocumentProcessing: preview, commitDocumentProcessing: commit,
    stageEditorAdjustments: vi.fn(), restoreStagedSnapshot: vi.fn(),
    discardPreview: () => { projected = canonical(); },
    pushProcessingHistoryEntry: entry => session.history.record({ ...entry,
      id: 'adjustment', documentId: session.id }), onCommitted: observe
  }));
  return { session, controller, renderer, preview, commit, observe, canonical, replayBusy,
    get projected() { return projected; },
    lock: () => session.acquireMutationAdmission('Committed capture is pending.') };
};
const exposure = (value: BasicAdjustments) => ({ ...value, exposureEV: 2 });

describe('document-wide adjustment mutation admission', () => {
  it('rejects a locked begin without acquiring preview or interactive quality', () => {
    const f = setup(), barrier = f.lock();
    expect(f.controller.begin()).toBeNull();
    expect(f.controller.active).toBe(false);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.renderer.setScopeInteractionActive).not.toHaveBeenCalled();
    expect(f.renderer.setLensBlurInteractionActive).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    barrier.release();
  });
  it('rejects a changed discrete write but permits a pure equal-value no-op under lock', () => {
    const f = setup(), revision = f.session.getSnapshot().documentRevision, barrier = f.lock();
    expect(f.controller.changeResult(exposure)).toBe('rejected');
    expect(f.controller.changeResult(value => ({ ...value }))).toBe('unchanged');
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().documentRevision).toBe(revision);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    barrier.release();
  });
  it.each(['sample', 'terminal', 'during-sample'] as const)('rejects changed active work blocked at %s', where => {
    const f = setup(), token = f.controller.begin()!;
    expect(f.controller.changeResult(exposure, 'grade', token)).toBe('applied');
    const revision = f.session.getSnapshot().documentRevision;
    let barrier: ReturnType<typeof f.lock>;
    if (where === 'during-sample') {
      expect(f.controller.changeResult(value => {
        barrier = f.lock(); return { ...value, exposureEV: 3 };
      }, 'grade', token)).toBe('rejected');
    } else {
      barrier = f.lock();
      if (where === 'sample') expect(f.controller.changeResult(exposure, 'grade', token)).toBe('rejected');
    }
    expect(f.controller.end(token)).toBe('rejected');
    expect(f.controller.active).toBe(false);
    expect(f.preview).toHaveBeenCalledOnce();
    expect(f.projected.exposureEV).toBe(0);
    expect(f.canonical().exposureEV).toBe(0);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().documentRevision).toBe(revision);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    barrier!.release();
  });
  it.each(['cancel', 'unchanged-end'] as const)('allows %s cleanup while blocked', terminal => {
    const f = setup(), token = f.controller.begin()!, barrier = f.lock();
    if (terminal === 'cancel') f.controller.cancel(token);
    else expect(f.controller.end(token)).toBe('unchanged');
    expect(f.controller.active).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    barrier.release();
  });
  it('admits a fresh gesture after release and replays processing through busy history', async () => {
    const f = setup(), barrier = f.lock();
    expect(f.controller.begin()).toBeNull();
    f.controller.reset(); barrier.release();
    const token = f.controller.begin()!;
    f.controller.changeResult(exposure, 'grade', token);
    expect(f.controller.end(token)).toBe('committed');
    expect(f.session.history.getSnapshot().undoDepth).toBe(1);
    expect(f.observe).toHaveBeenCalledOnce();
    await expect(f.session.history.undo()).resolves.toBe(true);
    expect(f.canonical().exposureEV).toBe(0);
    await expect(f.session.history.redo()).resolves.toBe(true);
    expect(f.canonical().exposureEV).toBe(2);
    expect(f.replayBusy).toEqual([false, true, true]);
  });
  it('rejects a queued global begin that arrives after admission closes', async () => {
    const f = setup(), report = vi.fn();
    let admit!: (result: { status: 'admitted' }) => void;
    const coordinator = createAdjustmentInteractionCoordinator(f.controller,
      () => new Promise(resolve => { admit = resolve; }), () => ({ isCurrent: () => true }), report);
    const handle = coordinator.begin('exposure');
    coordinator.change(handle, exposure);
    const barrier = f.lock();
    const terminal = coordinator.finishForFile();
    admit({ status: 'admitted' });
    await expect(terminal).rejects.toThrow('could not begin');
    expect(report).toHaveBeenCalledOnce();
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    barrier.release();
  });
});
