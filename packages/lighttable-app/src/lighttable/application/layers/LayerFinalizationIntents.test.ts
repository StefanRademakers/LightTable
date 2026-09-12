import { expect, it, vi } from 'vitest';
import { LayerFinalizationIntents, type LayerFinalizationIntentPorts } from './LayerFinalizationIntents';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { createRasterLayer, createTextLayer } from '../../editor/document/documentCommands';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { TextPropertyGestureController } from '../text/TextPropertyGestureController';
import type { FlowTextEditingSessionController } from '../text/flowTextEditingSession';
import { MountedDocumentAdmission } from '../interactions/MountedDocumentAdmission';
import { createInteractionTransitionCoordinator } from '../interactions/InteractionTransitionCoordinator';
const makeSession = () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  session.setDocument(createRasterLayer(createRasterLayer(createImageDocument('A', 100, 100, 'asset')))); session.setReady(); return session;
};
const fixture = () => {
  let session = makeSession(), renderer: object | null = {}, scopeIdentity = {}, mounted = true;
  let selected: LayerId[] = [], projectedId = session.getSnapshot().document!.id;
  const order: string[] = [];
  const ports: LayerFinalizationIntentPorts = {
    isMounted: () => mounted, getSession: () => session, getRenderer: () => renderer,
    getProjectedDocument: () => ({ id: projectedId }),
    captureScope: () => { const opening = scopeIdentity; return { isCurrent: () => opening === scopeIdentity }; },
    getSelectedLayerIds: () => selected, text: { finishBeforeTransition: vi.fn(() => { order.push('text'); return true; }) },
    requestAdmission: vi.fn(async () => { order.push('admission'); return { status: 'admitted' as const }; }),
    execute: vi.fn(async () => { order.push('execute'); return { status: 'completed' }; }), reportFailure: vi.fn()
  };
  return { ports, order, owner: new LayerFinalizationIntents(() => ports), session: () => session,
    select: (ids: LayerId[]) => { selected = ids; },
    retire: (kind: 'session' | 'renderer' | 'scope' | 'unmount' | 'disposed' | 'mixed') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'renderer') renderer = {};
      else if (kind === 'scope') scopeIdentity = {};
      else if (kind === 'disposed') session.dispose();
      else if (kind === 'mixed') projectedId = 'wrong' as typeof projectedId;
      else mounted = false;
    } };
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
it.each(['mergeDown', 'mergeSelected', 'flattenGroup', 'flattenImage'] as const)('%s waits for truthful text, existing admission and actual completion', async method => {
  const f = fixture(), ids = f.session().getSnapshot().document!.layers.map(layer => layer.id);
  const pending = deferred<{ status: string }>(); vi.mocked(f.ports.execute).mockReturnValue(pending.promise);
  const result = method === 'mergeSelected' ? f.owner.mergeSelected(ids) : method === 'flattenGroup' ? f.owner.flattenGroup(ids[0]) : f.owner[method]();
  expect(f.order).toEqual(['text', 'admission']); await Promise.resolve();
  let done = false; void result.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
  pending.resolve({ status: 'completed' }); expect(await result).toBe(true);
  expect(vi.mocked(f.ports.execute).mock.calls[0][0]).toBe(f.session().id);
});
it('contextual merge reads fresh same-session rows and siblings after transform settlement', async () => {
  const f = fixture(), opening = f.session().getSnapshot().document!;
  vi.mocked(f.ports.requestAdmission).mockImplementation(async () => {
    const next = createRasterLayer(opening); f.session().setDocument(next); f.select([next.activeLayerId!]);
    return { status: 'admitted' };
  });
  expect(await f.owner.mergeDown()).toBe(true);
  const current = f.session().getSnapshot().document!, ids = current.layers.map(layer => layer.id);
  expect(f.ports.execute).toHaveBeenCalledWith(f.session().id, 'layer.merge', { layerIds: ids.slice(-2) });
});
it('prefers the clicked row over stale canonical active layer and copies explicit selection before awaits', async () => {
  const f = fixture(), document = f.session().getSnapshot().document!, ids = document.layers.map(layer => layer.id);
  f.select([ids[1]]); await f.owner.mergeDown();
  expect(f.ports.execute).toHaveBeenLastCalledWith(f.session().id, 'layer.merge', { layerIds: ids.slice(0, 2) });
  const selected = ids.slice(0, 2), result = f.owner.mergeSelected(selected); selected.splice(0, 2, ids[2]);
  await result; expect(f.ports.execute).toHaveBeenLastCalledWith(f.session().id, 'layer.merge', { layerIds: ids.slice(0, 2) });
});
it('preserves contextual latest-row semantics during same-session admission rather than freezing pre-settlement rows', async () => {
  const f = fixture(), ids = f.session().getSnapshot().document!.layers.map(layer => layer.id);
  const pending = deferred<{ status: 'admitted' }>(); vi.mocked(f.ports.requestAdmission).mockReturnValue(pending.promise);
  f.select([ids[2]]); const result = f.owner.mergeDown(); f.select([ids[1]]); pending.resolve({ status: 'admitted' });
  expect(await result).toBe(true);
  expect(f.ports.execute).toHaveBeenCalledWith(f.session().id, 'layer.merge', { layerIds: ids.slice(0, 2) });
});
it.each(['session', 'renderer', 'scope', 'unmount', 'disposed', 'mixed'] as const)('rejects %s retirement while admission waits without successor work/error', async kind => {
  const f = fixture(), pending = deferred<{ status: 'admitted' }>(); vi.mocked(f.ports.requestAdmission).mockReturnValue(pending.promise);
  const result = f.owner.flattenImage(); f.retire(kind); pending.resolve({ status: 'admitted' });
  expect(await result).toBe(false); expect(f.ports.execute).not.toHaveBeenCalled(); expect(f.ports.reportFailure).not.toHaveBeenCalled();
});
it('rechecks exact ownership after synchronous text completion before requesting admission', async () => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(() => { f.retire('session'); return true; });
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.requestAdmission).not.toHaveBeenCalled();
});
it('blocks a rejected text terminal visibly and accepts a true no-op terminal', async () => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockReturnValue(false);
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.reportFailure).toHaveBeenCalledOnce(); expect(f.ports.execute).not.toHaveBeenCalled();
  vi.mocked(f.ports.text.finishBeforeTransition).mockReturnValue(true); expect(await f.owner.flattenImage()).toBe(true);
});
it('does not double-report coordinator rejection but reports actual command rejection', async () => {
  const f = fixture(); vi.mocked(f.ports.requestAdmission).mockResolvedValueOnce({ status: 'rejected', reason: 'Already reported' });
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.reportFailure).not.toHaveBeenCalled();
  vi.mocked(f.ports.execute).mockResolvedValue({ status: 'rejected', message: 'Unsupported blend' });
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.reportFailure).toHaveBeenCalledWith('Unsupported blend');
});
it('reports a genuine current settlement failure exactly once through the actual mounted admission owner', async () => {
  const f = fixture();
  const transitions = createInteractionTransitionCoordinator({ settleMountedInteraction: async () => { throw new Error('Pixel terminal failed'); },
    reportFailure: f.ports.reportFailure });
  const admission = new MountedDocumentAdmission({ getSession: f.ports.getSession, getRenderer: f.ports.getRenderer,
    getImageDocument: f.ports.getProjectedDocument, captureScope: f.ports.captureScope, transitions, reportFailure: f.ports.reportFailure });
  f.ports.requestAdmission = admission.request;
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.execute).not.toHaveBeenCalled();
  expect(f.ports.reportFailure).toHaveBeenCalledExactlyOnceWith('Could not finish the active document interaction: Pixel terminal failed');
});
it('handles thrown command failures once while suppressing late retired failures', async () => {
  const f = fixture(); vi.mocked(f.ports.execute).mockRejectedValueOnce(new Error('GPU failed'));
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.reportFailure).toHaveBeenCalledWith('GPU failed');
  vi.mocked(f.ports.execute).mockImplementation(async () => { f.retire('session'); throw new Error('Old error'); });
  expect(await f.owner.flattenImage()).toBe(false); expect(f.ports.reportFailure).toHaveBeenCalledOnce();
});
it('reports merge eligibility failure without dispatch and never assumes accepted async work is completed', async () => {
  const f = fixture(); f.select([f.session().getSnapshot().document!.layers[0].id]);
  expect(await f.owner.mergeDown()).toBe(false); expect(f.ports.execute).not.toHaveBeenCalled();
  expect(f.ports.reportFailure).toHaveBeenCalledWith('The active layer has no layer below it to merge with.');
  vi.mocked(f.ports.execute).mockResolvedValue({ status: 'accepted' }); expect(await f.owner.flattenImage()).toBe(false);
});
it.each(['noop', 'blocked', 'failed'] as const)('uses the actual text/mutation terminal before reserving finalization: %s', async mode => {
  const f = fixture(), session = f.session();
  session.setDocument(createTextLayer(session.getSnapshot().document!, createDefaultTextLayerData(), 'Text'));
  let blocked = false;
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: next => session.setDocument(next), previewSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushHistoryEntry: () => { if (mode === 'failed') throw new Error('Text history rejected'); }, isMutationBlocked: () => blocked }));
  const text = new TextPropertyGestureController(() => ({ getDocument: () => session.getSnapshot().document,
    getCommandDocumentId: () => session.id, documentMutations: mutations,
    textEditing: { getSnapshot: () => ({ status: 'idle' }) } as unknown as FlowTextEditingSessionController,
    recordObservedCommand: vi.fn(), reportError: vi.fn(), requestFrame: () => 1, cancelFrame: vi.fn() }));
  expect(text.begin(session.getSnapshot().document!.activeLayerId)).toBe(true);
  if (mode !== 'noop') { text.queuePaint({ fontSize: 48 }); text.flushPaint(); }
  if (mode === 'blocked') blocked = true;
  f.ports.text.finishBeforeTransition = next => text.finishBeforeTransition(next);
  expect(await f.owner.flattenImage()).toBe(mode === 'noop');
  expect(f.ports.requestAdmission).toHaveBeenCalledTimes(mode === 'noop' ? 1 : 0);
  expect(f.ports.execute).toHaveBeenCalledTimes(mode === 'noop' ? 1 : 0);
  expect(f.ports.reportFailure).toHaveBeenCalledTimes(mode === 'noop' ? 0 : 1);
});
