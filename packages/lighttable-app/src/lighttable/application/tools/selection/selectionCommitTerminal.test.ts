import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedSelectionProjection, SelectionRevision, TransactionId } from '@lighttable/editor-kernel';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import { createFullCanvasSelection, type SelectionOperation } from '../../../editor/selection/selectionTypes';
import { DocumentSession, type DocumentSessionId } from '../../documents/documentSession';
import type { LightTableCommittedSelection } from './DocumentSelectionStateStore';
import { SelectionShapeCommandService, type SelectionProjectionCommandPort } from './SelectionShapeCommandService';
import { createSelectionSessionController, type SelectionSessionDependencies } from './useSelectionSessionController';
import { createMountedSelectionCommandBinding } from './createMountedSelectionCommandBinding';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const createSession = () => {
  const session = new DocumentSession({ id: 'same-workspace' as DocumentSessionId,
    source: { id: 'source', name: 'Selection', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Selection', 10, 8, 'asset')); session.setReady();
  sessions.push(session);
  return session;
};
const fixture = () => {
  const session = createSession(), successor = createSession();
  let mounted = session;
  const coverage = SelectionMaskSnapshot.fromRaw(10, 8, new Uint16Array(80).fill(0x3c00));
  const prepare = (baseline: LightTableCommittedSelection, operation: SelectionOperation | null,
    transactionId: TransactionId): PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation> => ({
    transactionId, baselineRevision: baseline.revision,
    result: { ...baseline, revision: (baseline.revision + 1) as SelectionRevision,
      active: Boolean(operation), coverage: operation ? coverage : SelectionMaskSnapshot.inactive(10, 8),
      supportBounds: operation ? { x: 0, y: 0, width: 10, height: 8 } : null,
      provenance: operation ? [operation] : [] },
    activate: () => ({ accept: vi.fn(), rollback: vi.fn() }), dispose: vi.fn()
  });
  const projection: SelectionProjectionCommandPort = {
    setCommittedSelectionProjection: vi.fn(),
    prepareSelectionOperationProjection: vi.fn(async (_, baseline, intent, id) => prepare(baseline, intent.operation, id)),
    prepareSelectionMagicWandProjection: vi.fn(async (_, baseline, intent, id) => prepare(baseline, intent.provenance, id)),
    prepareSelectionShapeProjection: vi.fn(), prepareSelectionSnapshotProjection: vi.fn(),
    prepareSelectionTranslationProjection: vi.fn(), prepareSelectionPaintProjection: vi.fn()
  };
  const service = new SelectionShapeCommandService(session, () => projection, () => mounted === session);
  let release!: () => void, committed!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  const committedSignal = new Promise<void>(resolve => { committed = resolve; });
  const holdDelivery = async (execution: Promise<boolean>) => {
    const applied = await execution;
    expect(applied).toBe(true); committed(); await delivery; return applied;
  };
  const renderer = { setSelectionPreviewProjection: vi.fn(), setCommittedSelectionProjection: vi.fn(),
    beginSelectionPaintPreview: vi.fn(() => null) };
  const setError = vi.fn(), observe = vi.fn();
  const dependencies: SelectionSessionDependencies = {
    getDocument: () => mounted.getSnapshot().document,
    getRenderer: () => mounted === session ? renderer : null,
    getSelection: () => mounted.getSnapshot().editor.selection,
    getSelectionMaskSnapshot: () => mounted.getSnapshot().editor.selectionMaskSnapshot,
    getSelectionSupportBounds: () => mounted.getSnapshot().editor.selectionSupportBounds,
    publishPointer: vi.fn(), publishDraft: vi.fn(), setError, onMagicWandCommitted: observe,
    commitOperation: vi.fn(intent => holdDelivery(service.executeOperation(intent))),
    commitMagicWand: vi.fn((intent, signal) => holdDelivery(service.executeMagicWand(intent, signal))),
    commitShape: vi.fn(), commitTranslation: vi.fn(), commitPaint: vi.fn(), commitRasterMask: vi.fn()
  };
  return { session, successor, service, renderer, dependencies, setError, observe, committedSignal, release,
    controller: createSelectionSessionController(() => dependencies),
    rebind: () => { mounted = successor; } };
};

describe('selection committed result versus mounted feedback lifetime', () => {
  it.each(['all', 'similar', 'wand'] as const)('delivers live %s feedback after actual canonical commit without changing ImageDocument identity', async kind => {
    const state = fixture();
    if (kind === 'similar') await state.service.executeOperation({ operation: createFullCanvasSelection(10, 8)[0]! });
    const document = state.session.getSnapshot().document!, layerId = document.activeLayerId!;
    const execution = kind === 'all' ? state.controller.applyState('all')
      : kind === 'similar' ? state.controller.selectSimilar(layerId, { tolerance: 20, antiAlias: true, sampleAllLayers: false })
      : state.controller.applyMagicWand(layerId, { x: 2, y: 3 }, 'replace', {
        tolerance: 20, antiAlias: true, sampleAllLayers: false, contiguous: true, sampleSize: 1
      });
    await state.committedSignal;
    expect(state.session.getSnapshot().document).toBe(document);
    state.release(); expect(await execution).toBe(true);
    expect(state.setError).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each([false, true])('retains actual UI Wand observation only for its live presentation (retired: %s)', async retired => {
    const state = fixture(), document = state.session.getSnapshot().document;
    expect(state.controller.magicWand({ x: 2, y: 3 }, 'replace', {
      tolerance: 20, antiAlias: true, sampleAllLayers: false, contiguous: true, sampleSize: 1
    })).toBe(true);
    await state.committedSignal;
    expect(state.session.getSnapshot().document).toBe(document);
    if (retired) { state.controller.retire(); state.rebind(); }
    state.release(); await state.controller.settle();
    expect(state.observe).toHaveBeenCalledTimes(retired ? 0 : 1);
    expect(state.setError).toHaveBeenCalledTimes(retired ? 0 : 1);
    expect(state.session.history.getSnapshot().undoDepth).toBe(1);
  });

  it('preserves a valid inactive clear no-op through the mounted binding and actual controller', async () => {
    const state = fixture(), before = state.session.getSnapshot();
    const execute = createMountedSelectionCommandBinding({
      session: state.session, renderer: state.renderer, registration: { isCurrent: () => true },
      getSession: () => state.session, getRenderer: () => state.renderer,
      getProjectedDocument: () => state.session.getSnapshot().document,
      captureScope: () => ({ assertCurrent: () => undefined }), settle: async () => undefined,
      selection: state.controller
    });
    expect(await execute({ kind: 'modify', operation: 'clear' })).toEqual({ operation: 'clear' });
    expect(state.session.getSnapshot()).toBe(before);
    expect(state.dependencies.commitOperation).not.toHaveBeenCalled();
  });

  it.each(['all', 'similar', 'wand'] as const)('retains actual committed %s success after retirement without successor feedback', async kind => {
    const state = fixture();
    if (kind === 'similar') {
      expect(await state.service.executeOperation({ operation: createFullCanvasSelection(10, 8)[0]! })).toBe(true);
    }
    const beforeDepth = state.session.history.getSnapshot().undoDepth;
    const beforeRevision = state.session.getSnapshot().documentRevision;
    const layerId = state.session.getSnapshot().document!.activeLayerId!;
    const execution = kind === 'all' ? state.controller.applyState('all')
      : kind === 'similar' ? state.controller.selectSimilar(layerId, {
        tolerance: 20, antiAlias: true, sampleAllLayers: false
      }) : state.controller.applyMagicWand(layerId, { x: 2, y: 3 }, 'replace', {
        tolerance: 20, antiAlias: true, sampleAllLayers: false, contiguous: true, sampleSize: 1
      });
    const queued = state.controller.applyState('invert');
    await state.committedSignal;
    expect(state.session.history.getSnapshot().undoDepth).toBe(beforeDepth + 1);
    expect(state.session.getSnapshot().documentRevision).toBeGreaterThan(beforeRevision);
    expect(state.session.getSnapshot().editor.selectionMaskSnapshot?.active).toBe(true);
    const committed = state.session.getSnapshot(), successor = state.successor.getSnapshot();
    state.controller.retire(); state.rebind(); state.release();
    expect(await execution).toBe(true);
    expect(await queued).toBe(false);
    expect(state.session.getSnapshot()).toBe(committed);
    expect(state.successor.getSnapshot()).toBe(successor);
    expect(state.setError).not.toHaveBeenCalled(); expect(state.observe).not.toHaveBeenCalled();
  });
});
