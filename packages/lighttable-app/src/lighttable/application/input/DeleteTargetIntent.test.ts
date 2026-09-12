import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectionRevision } from '@lighttable/editor-kernel';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import { createRasterLayer, setActiveLayer } from '../../editor/document/documentCommands';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createFillCommandController, type FillHistoryEntry } from '../tools/fill/useFillCommandController';
import { MountedDocumentAdmission } from '../interactions/MountedDocumentAdmission';
import { createInteractionTransitionCoordinator } from '../interactions/InteractionTransitionCoordinator';
import { DeleteTargetIntent, type DeleteTargetIntentPorts } from './DeleteTargetIntent';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const createSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'Delete', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Delete', 8, 6, 'asset')); session.setReady(); sessions.push(session); return session;
};
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
// Allow the existing coordinator/admission Promise chain to finish, without replacing it with a test queue.
const drain = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });
const fixture = () => {
  const session = createSession(), renderer = {
    beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
    finishPixelEdit: vi.fn(() => ({ byteSize: 96, undo: () => true, redo: () => true, destroy: vi.fn() })),
    cancelPixelEdit: vi.fn(), applyPixelHistory: vi.fn((_edit: ReversiblePixelEdit, _direction: 'undo' | 'redo') => true)
  };
  const current = { session: session as DocumentSession | undefined, renderer: renderer as object | null,
    mounted: true, generation: 0, projected: session.getSnapshot().document, tool: 'brush' as ReturnType<DeleteTargetIntentPorts['getTool']>,
    selected: [] as LayerId[] };
  const scope = () => { const generation = current.generation; return { isCurrent: () => current.generation === generation }; };
  const reportFailure = vi.fn(), onFillCommitted = vi.fn(), setStatus = vi.fn();
  const applySnapshot = (document: NonNullable<ReturnType<DocumentSession['getSnapshot']>['document']>) => session.setDocument(document);
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document, applySnapshot, previewSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushHistoryEntry: () => { throw new Error('Fill must use its pixel-history reservation.'); },
    isMutationBlocked: () => !session.isAcceptingMutations()
  }));
  let historyId = 0;
  const reserveHistoryEntry = (entry: FillHistoryEntry) => session.history.reserve({
    ...entry, id: `fill-${++historyId}`, documentId: session.id
  });
  const fill = createFillCommandController(() => ({
    // Deliberately stale UI defaults: Delete must pass its canonical admitted target explicitly.
    getDocument: () => ({ ...session.getSnapshot().document!, activeLayerId: 'stale-layer' as LayerId }),
    getChannel: () => 'mask', getRenderer: () => renderer, documentMutations: mutations,
    applyDocumentSnapshot: applySnapshot, reserveHistoryEntry, setStatus, setError: reportFailure, onFillCommitted
  }));
  const settle = vi.fn(async (): Promise<void> => undefined);
  const transitions = createInteractionTransitionCoordinator({ settleMountedInteraction: () => settle(), reportFailure });
  const admission = new MountedDocumentAdmission({
    getSession: () => current.session, getRenderer: () => current.renderer, getImageDocument: () => current.projected,
    captureScope: scope, transitions, reportFailure
  });
  const ports: DeleteTargetIntentPorts = {
    isMounted: () => current.mounted, getSession: () => current.session, getRenderer: () => current.renderer,
    getProjectedDocument: () => current.projected, captureScope: scope, getTool: () => current.tool,
    getSelectedLayerIds: () => current.selected, vector: { deleteSelection: vi.fn(() => true) },
    admission, fill, transform: { isActive: vi.fn(() => false), cancel: vi.fn() },
    deleteLayers: vi.fn(), reportFailure
  };
  const select = (active: boolean, clipped = false) => {
    const store = new DocumentSelectionStateStore(session), before = store.acquire(session.getSnapshot().documentRevision).selection;
    const coverage = active ? SelectionMaskSnapshot.fromRaw(8, 6, new Uint16Array(48).fill(clipped ? 0 : 0x3c00))
      : SelectionMaskSnapshot.inactive(8, 6);
    expect(store.compareAndSwap(before.revision, { ...before, revision: (before.revision + 1) as SelectionRevision,
      active, coverage, supportBounds: active && !clipped ? { x: 0, y: 0, width: 8, height: 6 } : null, provenance: [] })).toBe(true);
    return coverage;
  };
  return { session, current, renderer, ports, owner: new DeleteTargetIntent(() => ports), select,
    settle, reportFailure, onFillCommitted, setStatus, mutations };
};

describe('DeleteTargetIntent with canonical selection and existing fill/history owners', () => {
  it.each([false, true])('keeps paint-only/clipped=%s active coverage on the pixel route with one observed reversible fill', async clipped => {
    const f = fixture(); f.select(true, clipped); const before = f.session.getSnapshot().document!;
    expect(f.session.getSnapshot().editor.selection).toEqual([]);
    f.owner.run(); await drain();
    expect(f.renderer.fillLayerColor).toHaveBeenCalledWith(before.activeLayerId, 'pixels', [0, 0, 0], false, 0);
    expect(f.ports.deleteLayers).not.toHaveBeenCalled(); expect(f.session.history.getSnapshot().undoDepth).toBe(1);
    expect(f.onFillCommitted).toHaveBeenCalledExactlyOnceWith({ layerId: before.activeLayerId, channel: 'pixels',
      color: '#000000', preserveTransparency: false, opacity: 0 }, { layerId: before.activeLayerId, channel: 'pixels' });
    const after = f.session.getSnapshot().document;
    await f.session.history.undo(); expect(f.session.getSnapshot().document).toBe(before);
    await f.session.history.redo(); expect(f.session.getSnapshot().document).toBe(after);
    expect(f.renderer.applyPixelHistory.mock.calls.map(call => call[1])).toEqual(['undo', 'redo']);
  });

  it('rejects a disappeared selection after settlement instead of clearing the whole target', async () => {
    const f = fixture(); f.select(true); const gate = defer(); f.settle.mockImplementation(() => gate.promise);
    f.owner.run(); await drain(); f.select(false); const before = f.session.getSnapshot().document;
    gate.resolve(); await drain();
    expect(f.renderer.beginBrushStroke).not.toHaveBeenCalled(); expect(f.session.getSnapshot().document).toBe(before);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0); expect(f.onFillCommitted).not.toHaveBeenCalled();
    expect(f.ports.deleteLayers).not.toHaveBeenCalled(); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('no longer active'));
  });

  it('accepts post-settlement active replacement coverage without confusing either revision clock with intent', async () => {
    const f = fixture(); const opening = f.select(true), revision = f.session.getSnapshot().documentRevision;
    f.settle.mockImplementation(async () => { f.select(true, true); });
    f.owner.run(); await drain();
    expect(f.session.getSnapshot().editor.selectionMaskSnapshot).not.toBe(opening);
    expect(f.session.getSnapshot().documentRevision).toBeGreaterThan(revision);
    expect(f.renderer.fillLayerColor).toHaveBeenCalledOnce(); expect(f.session.history.getSnapshot().undoDepth).toBe(1);
  });

  it.each(['layer', 'channel'] as const)('rejects changed canonical %s despite lagging projected UI', async kind => {
    const f = fixture(); f.select(true);
    f.settle.mockImplementation(async () => {
      if (kind === 'channel') f.session.updateEditor(editor => ({ ...editor, activeChannel: 'mask' }));
      else f.session.setDocument(createRasterLayer(f.session.getSnapshot().document!));
    });
    f.owner.run(); await drain();
    expect(f.renderer.beginBrushStroke).not.toHaveBeenCalled(); expect(f.ports.deleteLayers).not.toHaveBeenCalled();
    expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('target changed'));
  });

  it.each(['session', 'renderer', 'generation', 'dispose', 'unmount'] as const)('does not deliver through retired %s ownership', async kind => {
    const f = fixture(); f.select(true); const gate = defer(); f.settle.mockImplementation(() => gate.promise);
    f.owner.run(); await drain();
    if (kind === 'session') f.current.session = createSession();
    if (kind === 'renderer') f.current.renderer = {};
    if (kind === 'generation') f.current.generation++;
    if (kind === 'dispose') f.session.dispose();
    if (kind === 'unmount') f.current.mounted = false;
    gate.resolve(); await drain();
    expect(f.renderer.beginBrushStroke).not.toHaveBeenCalled(); expect(f.reportFailure).not.toHaveBeenCalled();
  });

  it('reports a real settlement failure once and never starts fill', async () => {
    const f = fixture(); f.select(true); f.settle.mockRejectedValue(new Error('transform failed'));
    f.owner.run(); await drain();
    expect(f.renderer.beginBrushStroke).not.toHaveBeenCalled(); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('transform failed'));
  });

  it('leaves rejected fill reporting to the existing fill owner', async () => {
    const f = fixture(); f.select(true); f.renderer.fillLayerColor.mockReturnValue(false);
    f.owner.run(); await drain(); expect(f.reportFailure).toHaveBeenCalledOnce(); expect(f.onFillCommitted).not.toHaveBeenCalled();
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });

  it('keeps the committed fill and observation when observation retires the UI', async () => {
    const f = fixture(); f.select(true); f.onFillCommitted.mockImplementation(() => { f.current.mounted = false; });
    f.owner.run(); await drain(); expect(f.session.history.getSnapshot().undoDepth).toBe(1);
    expect(f.onFillCommitted).toHaveBeenCalledOnce(); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('gives live vector subobjects precedence without settlement or transform cancellation', () => {
    const f = fixture(); f.select(true); f.current.tool = 'vector-direct-select';
    f.session.updateEditor(editor => ({ ...editor, vectorSelection: { ...editor.vectorSelection,
      elements: [{ layerId: f.session.getSnapshot().document!.activeLayerId!, elementId: 'element' }] } }));
    f.owner.run(); expect(f.ports.vector.deleteSelection).toHaveBeenCalledOnce(); expect(f.settle).not.toHaveBeenCalled();
    expect(f.ports.transform.cancel).not.toHaveBeenCalled(); expect(f.ports.deleteLayers).not.toHaveBeenCalled();
  });

  it('copies selected rows before transform cancellation and ignores retained vector state for Move', () => {
    const f = fixture(); const first = f.session.getSnapshot().document!.activeLayerId!;
    const next = createRasterLayer(f.session.getSnapshot().document!); f.session.setDocument(next);
    f.current.selected = [first, next.activeLayerId!]; f.current.tool = 'transform';
    f.session.updateEditor(editor => ({ ...editor, vectorSelection: { ...editor.vectorSelection,
      elements: [{ layerId: first, elementId: 'element' }] } }));
    vi.mocked(f.ports.transform.isActive).mockReturnValue(true);
    vi.mocked(f.ports.transform.cancel).mockImplementation(() => {
      f.current.selected.splice(0); f.session.setDocument(setActiveLayer(next, first));
    });
    f.owner.run(); expect(f.ports.deleteLayers).toHaveBeenCalledWith([first, next.activeLayerId], expect.any(Function));
    expect(f.settle).not.toHaveBeenCalled(); expect(f.ports.vector.deleteSelection).not.toHaveBeenCalled();
  });

  it('rechecks lifetime after synchronous transform cancellation', () => {
    const f = fixture(); vi.mocked(f.ports.transform.isActive).mockReturnValue(true);
    vi.mocked(f.ports.transform.cancel).mockImplementation(() => { f.current.renderer = {}; });
    f.owner.run(); expect(f.ports.deleteLayers).not.toHaveBeenCalled(); expect(f.reportFailure).not.toHaveBeenCalled();
  });

  it('does not treat two absent document IDs after cancellation as a current target', () => {
    const f = fixture(); vi.mocked(f.ports.transform.isActive).mockReturnValue(true);
    vi.mocked(f.ports.transform.cancel).mockImplementation(() => { f.session.setDocument(null); f.current.projected = null; });
    f.owner.run(); expect(f.ports.deleteLayers).not.toHaveBeenCalled();
  });

  it('captures active-layer fallback and scopes delayed semantic rejection reporting', () => {
    const f = fixture(); f.owner.run(); const call = vi.mocked(f.ports.deleteLayers).mock.calls[0]!;
    expect(call[0]).toEqual([f.session.getSnapshot().document!.activeLayerId]);
    call[1]('current rejection'); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith('current rejection');
    f.current.session = createSession(); call[1]('old rejection'); expect(f.reportFailure).toHaveBeenCalledOnce();
  });

  it('keeps no-document Delete a no-op but exposes missing current canonical coverage', () => {
    const f = fixture(); f.current.session = undefined; f.owner.run(); expect(f.reportFailure).not.toHaveBeenCalled();
    f.current.session = f.session; f.session.updateEditor(editor => ({ ...editor, selectionMaskSnapshot: null }));
    f.owner.run(); expect(f.reportFailure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('exact committed selection'));
    expect(f.ports.deleteLayers).not.toHaveBeenCalled();
  });
});
