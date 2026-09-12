import { afterEach, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { ensureRasterLayerLocalProcessing, setActiveLayer, createRasterLayer } from '../../editor/document/documentCommands';
import { createLayerProcessingCreationCommands } from '../layers/layerProcessingCreationCommands';
import { PropertiesInspectorPresentation } from '../properties/PropertiesInspectorPresentation';
import { AdjustmentCreationIntents } from './AdjustmentCreationIntents';
import { captureAdjustmentCreationFeedback, createMountedAdjustmentCreationBinding } from './createMountedAdjustmentCreationBinding';
import type { SemanticAdjustmentCreationCommand } from '../commands/semanticAdjustmentCreationCommandContract';
import { dispatchSemanticAdjustmentCreation } from '../commands/semanticContextualEditDispatcher';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('A', 100, 50, 'asset')); session.setReady(); sessions.push(session); return session;
};
const fixture = () => {
  const session = makeSession(); let currentSession = session, renderer = {}, scope = {}, mounted = true;
  let projected: Pick<ImageDocument, 'id'> | null = session.getSnapshot().document;
  const schedule = vi.fn(() => 1);
  const properties = new PropertiesInspectorPresentation({ capture: () => ({ isCurrent: () => true, reveal: vi.fn() }),
    schedule, cancel: vi.fn() }); properties.mount(); properties.reconcile(session.getSnapshot().document);
  const history: DocumentMutationHistoryEntry[] = [];
  let afterCommit = () => {}, blocked = false;
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: next => { session.setDocument(next); properties.reconcile(next); },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: entry => { history.push(entry); afterCommit(); },
    isMutationBlocked: () => blocked }));
  const readPorts = () => ({ session, renderer, registration: (() => { const old = scope; return { isCurrent: () => old === scope }; })(),
    getSession: () => currentSession, getRenderer: () => renderer, getProjectedDocument: () => projected });
  const channel = vi.fn(), error = vi.fn(), status = vi.fn();
  let deferredChannel: (() => void) | null = null;
  const creation = createLayerProcessingCreationCommands({ beginTransaction: mutations.begin,
    commitTransaction: (transaction, next, description) => transaction.stage(() => next) && transaction.commit(description),
    captureFeedback: () => captureAdjustmentCreationFeedback(readPorts(), {
      setActiveChannel: (value, isCurrent) => { deferredChannel = () => { if (isCurrent()) channel(value); }; }, setError: error, setStatus: status }) });
  const bound = createMountedAdjustmentCreationBinding({ ...readPorts(), properties, creation: {
    createLocalProcessing: (layerId, kind) => mutations.change(document => ensureRasterLayerLocalProcessing(document, layerId, kind)),
    createAdjustmentLayerOfKind: creation.create, createAttachedAdjustment: creation.attach } });
  const execute = vi.fn(async (_id: DocumentSessionId, command: SemanticAdjustmentCreationCommand, _revision: number) => {
    const result = bound(command); return result ? { status: 'completed' } : { status: 'rejected', message: 'Not created' };
  });
  const intent = new AdjustmentCreationIntents(() => ({ isMounted: () => mounted,
    getSession: () => currentSession, getRenderer: () => renderer, getProjectedDocument: () => projected,
    captureScope: () => { const opening = scope; return { isCurrent: () => scope === opening }; }, properties, execute, reportFailure: error }));
  return { session, properties, schedule, history, mutations, bound, intent, execute, channel, error, status,
    layerId: session.getSnapshot().document!.activeLayerId!, flushChannel: () => deferredChannel?.(),
    afterCommit: (callback: () => void) => { afterCommit = callback; }, block: () => { blocked = true; },
    retire: (kind: 'session' | 'renderer' | 'scope' | 'disposed' | 'mixed' | 'unmounted') => {
      if (kind === 'session') currentSession = makeSession(); if (kind === 'renderer') renderer = {};
      if (kind === 'scope') scope = {}; if (kind === 'disposed') session.dispose();
      if (kind === 'mixed') projected = createImageDocument('Other', 100, 50, 'other'); if (kind === 'unmounted') mounted = false;
    } };
};

it('contextual Curves creates once then reveals the exact existing local owner without history', async () => {
  const f = fixture(); expect(await f.intent.curves()).toBe(true); expect(f.history).toHaveLength(1);
  const after = f.session.getSnapshot(); expect(await f.intent.curves()).toBe(true);
  expect(f.session.getSnapshot()).toBe(after); expect(f.history).toHaveLength(1); expect(f.execute).toHaveBeenCalledOnce();
  expect(f.properties.getSnapshot()).toEqual({ kind: 'processing', layerId: f.layerId, owner: 'curves' });
});
it.each(['standalone', 'attach'] as const)('explicit %s always authors new nodes and exact one-entry undo/redo', async placement => {
  const f = fixture(); expect(await f.intent[placement]('curves')).toBe(true);
  const first = f.session.getSnapshot().document!; expect(f.history).toHaveLength(1);
  f.history[0].undo(); expect(f.session.getSnapshot().document!.layers).toHaveLength(1);
  f.history[0].redo(); expect(f.session.getSnapshot().document).toBe(first);
  if (placement === 'standalone') f.session.setDocument(setActiveLayer(first, f.layerId));
  expect(await f.intent[placement]('curves')).toBe(true); expect(f.history).toHaveLength(2);
});
it.each(['local', 'attached', 'adjustment-layer'] as const)('returns committed %s result after retirement without old feedback', placement => {
  const f = fixture(); f.afterCommit(() => { f.retire('session'); });
  const result = f.bound(placement === 'adjustment-layer' ? { kind: 'curves', placement, aboveLayerId: f.layerId }
    : { kind: 'curves', placement, layerId: f.layerId });
  expect(result).toMatchObject({ kind: 'curves', placement }); expect(f.history).toHaveLength(1);
  if (placement === 'adjustment-layer') expect(result!.layerId).toBe(f.session.getSnapshot().document!.activeLayerId);
  f.flushChannel(); expect(f.channel).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled(); expect(f.status).not.toHaveBeenCalled();
  expect(f.properties.getSnapshot()).not.toMatchObject({ kind: 'attached-processing' });
});
it.each(['session', 'renderer', 'scope', 'disposed', 'mixed'] as const)('rejects registered %s replacement before mutation', kind => {
  const f = fixture(); f.retire(kind);
  expect(() => f.bound({ kind: 'curves', placement: 'local', layerId: f.layerId })).toThrow('retired');
  expect(f.history).toHaveLength(0);
});
it('a deferred channel updater cannot target the successor after successful creation', () => {
  const f = fixture(); expect(f.bound({ kind: 'curves', placement: 'adjustment-layer' })).not.toBeNull();
  f.retire('renderer'); f.flushChannel(); expect(f.channel).not.toHaveBeenCalled(); expect(f.history).toHaveLength(1);
});
it.each(['show', 'begin', 'invalidate', 'retire'] as const)('does not overwrite newer Properties %s during own canonical publication', mode => {
  const f = fixture(); f.afterCommit(() => {
    if (mode === 'show') f.properties.show({ kind: 'document-processing', owner: 'lens-fx' });
    else if (mode === 'begin') f.properties.beginIntent();
    else if (mode === 'invalidate') f.properties.invalidate(); else f.properties.retire();
  });
  const result = f.bound({ kind: 'curves', placement: 'adjustment-layer' }); expect(result).not.toBeNull();
  expect(f.history).toHaveLength(1);
  if (mode === 'show') expect(f.properties.getSnapshot()).toEqual({ kind: 'document-processing', owner: 'lens-fx' });
  // Own reconciliation is allowed but cannot schedule another reveal after a newer intent.
  expect(f.schedule).toHaveBeenCalledTimes(mode === 'show' ? 1 : 0);
});
it('own standalone reconciliation keeps the creation presentation ticket, unlike an ordinary pending ticket', () => {
  const f = fixture(), ordinary = f.properties.beginIntent();
  const result = f.bound({ kind: 'curves', placement: 'adjustment-layer' })!;
  expect(ordinary.isCurrent()).toBe(false);
  expect(f.properties.getSnapshot()).toEqual({ kind: 'layer', layerId: result.layerId });
  expect(f.schedule).toHaveBeenCalledOnce();
});
it('semantic delivery trusts actual committed creation after view retirement rather than reading a later revision', async () => {
  const f = fixture(), opening = f.session.getSnapshot().document!;
  f.afterCommit(() => f.retire('session'));
  const result = await dispatchSemanticAdjustmentCreation({ kind: 'curves', placement: 'adjustment-layer' }, opening, f.bound);
  expect(result).toMatchObject({ ok: true, value: { layerId: f.session.getSnapshot().document!.activeLayerId } });
  expect(f.history).toHaveLength(1);
});
it('rejects creation failure and local no-op without guessing another revision as success', () => {
  const f = fixture(); const command = { kind: 'curves', placement: 'local', layerId: f.layerId } as const;
  expect(f.bound(command)).not.toBeNull(); const state = f.session.getSnapshot();
  expect(f.bound(command)).toBeNull(); expect(f.session.getSnapshot()).toBe(state);
  f.block(); expect(f.bound({ kind: 'curves', placement: 'adjustment-layer' })).toBeNull(); expect(f.history).toHaveLength(1);
});
it('pins contextual targets before dispatch and ignores later selected rows', async () => {
  const f = fixture(); const revision = f.session.getSnapshot().documentRevision;
  f.execute.mockImplementation(async (_id, command) => {
    f.session.setDocument(createRasterLayer(f.session.getSnapshot().document!));
    expect(command).toEqual({ kind: 'curves', placement: 'local', layerId: f.layerId }); return { status: 'completed' };
  });
  expect(await f.intent.curves()).toBe(true);
  expect(f.execute).toHaveBeenCalledWith(f.session.id, { kind: 'curves', placement: 'local', layerId: f.layerId }, revision);
});
