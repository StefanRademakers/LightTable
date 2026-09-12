import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createDocumentHistoryController } from '../commands/useDocumentHistoryController';
import { createDocumentProjectionBinding } from '../documents/documentProjectionBinding';
import { createImageDocument } from '../../editor/document/documentTypes';
import { cloneAdjustments, type BasicAdjustments } from '../../types';
import type { PropertiesInspectorTarget } from '../properties/propertiesInspectorTarget';
import { createMountedAdjustmentCommandBinding } from './MountedAdjustmentCommandBinding';
import { AdjustmentPresentationSynchronizer } from './AdjustmentPresentationSynchronizer';
import { projectAdjustmentSnapshot } from './projectAdjustmentSnapshot';

const sessions: DocumentSession[] = [];
afterEach(() => sessions.splice(0).forEach(session => session.dispose()));
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'image', name: 'Image', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Image', 20, 20, 'pixels')); session.setReady(); sessions.push(session); return session;
};
const fixture = () => {
  const session = makeSession(); let mounted = session, renderer = { pruneLayerRuntimes: vi.fn() }, registered = true, ready = true;
  let projected = session.getSnapshot().document;
  let target: PropertiesInspectorTarget = { kind: 'document-processing', owner: 'grade' };
  const present = vi.fn(), render = vi.fn(), adjustments = { finish: vi.fn() }, structure = { commit: vi.fn() };
  const synchronizer = new AdjustmentPresentationSynchronizer(present);
  const projection = createDocumentProjectionBinding({
    presentation: synchronizer, getPropertiesTarget: () => target, resetActiveAdjustmentPreview: vi.fn(),
    getDocument: () => mounted.getSnapshot().document,
    publishDocument: document => { mounted.setDocument(document); projected = document; },
    getDocumentAdjustments: () => mounted.getSnapshot().processing.adjustments,
    publishDocumentAdjustments: value => mounted.publishProcessing({ adjustments: value }),
    publishEditorAdjustments: synchronizer.publishPresentation, stageEditorAdjustments: vi.fn(),
    getGroupVisibility: () => mounted.getSnapshot().processing.groupVisibility,
    publishGroupVisibility: vi.fn(), publishRendererDocument: vi.fn(),
    publishRendererAdjustments: value => render(renderer, value)
  });
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => mounted.getSnapshot().document,
    applySnapshot: next => { mounted.setDocument(next); projected = next; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushHistoryEntry: entry => history.record(entry),
    isMutationBlocked: () => !mounted.isAcceptingMutations()
  }));
  const history = createDocumentHistoryController(() => ({
    documentId: mounted.id, history: mounted.history, getDocument: () => mounted.getSnapshot().document,
    getRenderer: () => renderer, finishOpenTransactions: vi.fn(), setError: vi.fn()
  }));
  const bind = () => createMountedAdjustmentCommandBinding({
    session, renderer, registration: { isCurrent: () => registered },
    getSession: () => mounted, getRenderer: () => renderer, getProjectedDocument: () => projected,
    isRendererReady: () => ready, adjustments, structure, mutations, projection, history
  });
  return { session, bind, adjustments, structure, present, render, projection, synchronizer, history,
    pruner: () => renderer.pruneLayerRuntimes,
    setTarget: (value: PropertiesInspectorTarget) => { target = value; },
    swapRenderer: () => { registered = false; renderer = { pruneLayerRuntimes: vi.fn() }; return renderer; },
    rebindRegistration: () => { registered = true; },
    mount: (value: DocumentSession) => { mounted = value; projected = value.getSnapshot().document; },
    retire: (kind: 'session' | 'renderer' | 'registration' | 'disposed' | 'mixed' | 'not-ready') => {
      if (kind === 'session') mounted = makeSession();
      if (kind === 'renderer') renderer = { pruneLayerRuntimes: vi.fn() };
      if (kind === 'registration') registered = false;
      if (kind === 'disposed') session.dispose();
      if (kind === 'mixed') projected = createImageDocument('Other', 20, 20, 'other');
      if (kind === 'not-ready') ready = false;
    }
  };
};
const setExposure = (binding: ReturnType<typeof createMountedAdjustmentCommandBinding>, exposureEV = 2) =>
  binding.executeBasicAdjustmentCommand({ target: { kind: 'document' }, values: { exposureEV } });

describe('mounted adjustment command binding', () => {
  it('queries one canonical session stamp after processing-only publication, retaining authored layer revision', () => {
    const f = fixture(), binding = f.bind(), document = f.session.getSnapshot().document!;
    f.session.publishProcessing({ adjustments: { ...f.session.getSnapshot().processing.adjustments, exposureEV: 3 } });
    const revision = f.session.getSnapshot().documentRevision;
    expect(f.session.getSnapshot().document).toBe(document); expect(revision).not.toBe(document.revision);
    expect(binding.queryBasicAdjustments({ kind: 'document' })).toMatchObject({ documentRevision: revision,
      targetRevision: revision, values: { exposureEV: 3 } });
    expect(binding.queryBasicAdjustments({ kind: 'layer', layerId: document.activeLayerId! })).toMatchObject({
      documentRevision: revision, targetRevision: document.layers[0]!.revision });
    expect(binding.queryAdjustments({ kind: 'document', owner: 'grade' })).toMatchObject({
      status: 'completed', documentRevision: revision, targetRevision: revision });
  });
  it.each(['session', 'renderer', 'registration', 'disposed', 'mixed', 'not-ready'] as const)(
    'rejects retained commands and queries before any terminal on %s retirement', kind => {
      const f = fixture(), binding = f.bind(); f.retire(kind);
      expect(() => setExposure(binding)).toThrow('retired');
      expect(() => binding.queryBasicAdjustments({ kind: 'document' })).toThrow('retired');
      expect(f.adjustments.finish).not.toHaveBeenCalled(); expect(f.present).not.toHaveBeenCalled();
    });
  it('rechecks exact ownership after synchronous adjustment terminal', () => {
    const f = fixture(), binding = f.bind(); f.adjustments.finish.mockImplementation(() => f.retire('session'));
    expect(() => setExposure(binding)).toThrow('retired');
    expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(0);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
  it('uses the fresh same-session document/processing after adjustment settlement', () => {
    const f = fixture(), binding = f.bind();
    f.adjustments.finish.mockImplementation(() => f.session.publishProcessing({ adjustments: {
      ...f.session.getSnapshot().processing.adjustments, contrast: 15 } }));
    setExposure(binding); expect(f.session.getSnapshot().processing.adjustments).toMatchObject({ exposureEV: 2, contrast: 15 });
    expect(f.session.history.getSnapshot().undoDepth).toBe(1);
  });
  it('preserves the live Properties target on undo and redo, without extra canonical presentation stamps', async () => {
    const f = fixture(), binding = f.bind(); setExposure(binding);
    const state = f.session.getSnapshot(), layerId = state.document!.activeLayerId!;
    const local = projectAdjustmentSnapshot({ document: state.document, documentAdjustments: state.processing.adjustments,
      targetLayerId: layerId, snapshot: { ...cloneAdjustments(state.processing.adjustments), exposureEV: 7 } }).document!;
    f.session.setDocument(local); f.mount(f.session); f.setTarget({ kind: 'layer', layerId });
    f.present.mockClear(); const before = f.session.getSnapshot().documentRevision;
    await f.session.history.undo();
    expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(0);
    expect(f.present).toHaveBeenLastCalledWith(expect.objectContaining({ exposureEV: 7 }), 'all');
    // One processing publication plus the history state transition, no presentation publication.
    expect(f.session.getSnapshot().documentRevision).toBe(before + 2);
    await f.session.history.redo(); expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(2);
    expect(f.present).toHaveBeenLastCalledWith(expect.objectContaining({ exposureEV: 7 }), 'all');
  });
  it('replays on the captured inactive session without touching an equal-ID successor', async () => {
    const f = fixture(), binding = f.bind(); setExposure(binding);
    const successor = makeSession(); f.mount(successor); const before = successor.getSnapshot();
    f.render.mockClear(); f.present.mockClear();
    await f.session.history.undo(); await f.session.history.redo();
    expect(successor.getSnapshot()).toBe(before); expect(f.render).not.toHaveBeenCalled(); expect(f.present).not.toHaveBeenCalled();
    expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(2);
  });
  it('same-session renderer rebind keeps history alive and projects only the successor renderer', async () => {
    const f = fixture(); setExposure(f.bind()); const renderer = f.swapRenderer(); f.render.mockClear();
    await f.session.history.undo(); expect(f.render).toHaveBeenCalledExactlyOnceWith(renderer, expect.objectContaining({ exposureEV: 0 }));
    await f.session.history.redo(); expect(f.render).toHaveBeenLastCalledWith(renderer, expect.objectContaining({ exposureEV: 2 }));
  });
  it('new bindings never reuse history command IDs', () => {
    const f = fixture(), record = vi.spyOn(f.session.history, 'record'); setExposure(f.bind()); setExposure(f.bind(), 3);
    const ids = record.mock.calls.map(([entry]) => entry.id);
    expect(new Set(ids).size).toBe(2);
    expect(f.pruner()).toHaveBeenCalledTimes(2);
  });
  it('keeps real history pruning on initial record and compensates a rejected history record', () => {
    const f = fixture(), binding = f.bind(), before = f.session.getSnapshot();
    const failure = new Error('History admission failed');
    vi.spyOn(f.session.history, 'record').mockImplementationOnce(() => { throw failure; });
    expect(() => setExposure(binding)).toThrow('History admission failed');
    expect(f.session.getSnapshot().processing.adjustments).toEqual(before.processing.adjustments);
    expect(f.session.getSnapshot().documentRevision).toBeGreaterThan(before.documentRevision);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    expect(f.present).toHaveBeenLastCalledWith(expect.objectContaining({ exposureEV: 0 }), 'grade');
    expect(f.pruner()).not.toHaveBeenCalled();
  });
  it('preserves current failure visibility and stops before structure after a failed adjustment terminal', () => {
    const f = fixture(), binding = f.bind(), failure = new Error('Grade commit rejected');
    f.adjustments.finish.mockImplementation(() => { throw failure; });
    expect(() => binding.executeProcessingStructure({ operation: 'remove', target: { kind: 'local',
      layerId: f.session.getSnapshot().document!.activeLayerId!, owner: 'grade' } })).toThrow(failure);
    expect(f.structure.commit).not.toHaveBeenCalled(); expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
  it('rejects structure retirement before the existing document mutation executes', () => {
    const f = fixture(), binding = f.bind(); f.structure.commit.mockImplementation(() => f.retire('renderer'));
    const before = f.session.getSnapshot();
    expect(() => binding.executeProcessingStructure({ operation: 'remove', target: { kind: 'local',
      layerId: before.document!.activeLayerId!, owner: 'grade' } })).toThrow('retired');
    expect(f.session.getSnapshot()).toBe(before);
  });
  it('preserves no-op commands under real history reservation but admits no changed publication', () => {
    const f = fixture(), binding = f.bind(), reservation = f.session.history.reserve({ id: 'held',
      documentId: f.session.id, type: 'held', label: 'Held', undo() {}, redo() {} });
    const before = f.session.getSnapshot();
    expect(setExposure(binding, 0).changed).toBe(false);
    expect(() => setExposure(binding)).toThrow('blocked');
    expect(f.session.getSnapshot()).toBe(before); expect(f.render).not.toHaveBeenCalled();
    expect(f.present).not.toHaveBeenCalled(); reservation.cancel();
  });
  it('maps Detail, Snapshot and Structure to their existing owners and preserves terminal ordering', () => {
    const f = fixture(), binding = f.bind(), order: string[] = [];
    f.adjustments.finish.mockImplementation(() => { order.push('adjustments'); });
    f.structure.commit.mockImplementation(() => { order.push('structure'); });
    expect(binding.executeDetailAdjustmentCommand({ target: { kind: 'document' }, values: { sharpeningAmount: 20 } }).changed).toBe(true);
    expect(binding.executeAdjustmentSnapshot({ target: { kind: 'document', owner: 'grade' }, snapshot: {
      ...cloneAdjustments(f.session.getSnapshot().processing.adjustments), exposureEV: 1 } }).changed).toBe(true);
    binding.executeProcessingStructure({ operation: 'set-enabled', target: { kind: 'local',
      layerId: f.session.getSnapshot().document!.activeLayerId!, owner: 'grade' }, enabled: false });
    expect(order).toEqual(['adjustments', 'adjustments', 'adjustments', 'structure']);
  });
});
