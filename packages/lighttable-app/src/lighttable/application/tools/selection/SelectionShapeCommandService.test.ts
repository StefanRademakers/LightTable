import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentAddress,
  PreparedSelectionProjection,
  SelectionRevision,
  TransactionId,
} from '@lighttable/editor-kernel';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { SelectionShapeProjectionIntent } from '../../../editor/rendering/SelectionShapeProjectionService';
import { DocumentSession, type DocumentSessionId } from '../../documents/documentSession';
import type { LightTableCommittedSelection } from './DocumentSelectionStateStore';
import {
  SelectionShapeCommandService,
  type SelectionProjectionCommandPort,
} from './SelectionShapeCommandService';

const operation: SelectionOperation = {
  mode: 'replace',
  shape: { kind: 'rectangle', points: [{ x: 2, y: 1 }, { x: 7, y: 6 }] },
};
const coverage = SelectionMaskSnapshot.fromRaw(10, 8, new Uint16Array(80).fill(0x3c00));

const prepared = (
  baseline: LightTableCommittedSelection,
  result: LightTableCommittedSelection,
  events: string[],
  id: TransactionId,
): PreparedSelectionProjection<SelectionMaskSnapshot, SelectionOperation> => ({
  transactionId: id,
  baselineRevision: baseline.revision,
  result,
  activate: () => {
    events.push('activate');
    return { accept: () => events.push('accept'), rollback: () => events.push('rollback') };
  },
  dispose: () => events.push('dispose'),
});

const setup = () => {
  const session = new DocumentSession({
    id: 'document-1' as DocumentSessionId,
    source: { id: 'source-1', name: 'image.png', mediaType: 'image/png' },
  });
  session.setDocument(createImageDocument('image.png', 10, 8, 'asset'));
  session.setReady();
  const events: string[] = [];
  const renderer: SelectionProjectionCommandPort = {
    setCommittedSelectionProjection: vi.fn((operations) => {
      events.push(`overlay:${operations.length}`);
    }),
    prepareSelectionShapeProjection: vi.fn(async (
      _document: DocumentAddress,
      baseline: LightTableCommittedSelection,
      intent: SelectionShapeProjectionIntent,
      id: TransactionId,
    ) => prepared(baseline, {
      ...baseline,
      revision: (baseline.revision + 1) as SelectionRevision,
      active: true,
      coverage,
      supportBounds: { x: 2, y: 1, width: 5, height: 5 },
      provenance: [intent.provenance],
    }, events, id)),
    prepareSelectionSnapshotProjection: vi.fn(async (
      _document: DocumentAddress,
      baseline: LightTableCommittedSelection,
      target: LightTableCommittedSelection,
      id: TransactionId,
    ) => prepared(baseline, {
      ...target,
      revision: (baseline.revision + 1) as SelectionRevision,
    }, events, id)),
  };
  return { session, renderer, events,
    service: new SelectionShapeCommandService(session, () => renderer) };
};

describe('SelectionShapeCommandService', () => {
  it('commits shape, exact history and document selection as one route', async () => {
    const { session, renderer, events, service } = setup();
    const intent: SelectionShapeProjectionIntent = {
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    };

    expect(await service.execute(intent)).toBe(true);
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 1,
      selection: [operation],
      selectionMaskSnapshot: coverage,
      selectionSupportBounds: { x: 2, y: 1, width: 5, height: 5 },
    });
    expect(session.history.getSnapshot()).toMatchObject({
      undoDepth: 1, redoDepth: 0, busy: false, dirty: false,
    });
    expect(events).toEqual(['activate', 'overlay:1', 'accept']);

    expect(await session.history.undo()).toBe(true);
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 2, selection: [], selectionSupportBounds: null,
    });
    expect(await session.history.redo()).toBe(true);
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 3, selection: [operation],
      selectionSupportBounds: { x: 2, y: 1, width: 5, height: 5 },
    });
    expect(renderer.prepareSelectionSnapshotProjection).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      'activate', 'overlay:1', 'accept',
      'activate', 'overlay:0', 'accept',
      'activate', 'overlay:1', 'accept',
    ]);
    session.dispose();
  });

  it('restores the canonical projection and leaves history empty when preparation fails', async () => {
    const { session, renderer, events, service } = setup();
    vi.mocked(renderer.prepareSelectionShapeProjection).mockRejectedValueOnce(
      new Error('GPU preparation failed'),
    );

    expect(await service.execute({
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    })).toBe(false);

    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 0, selection: [], selectionSupportBounds: null,
    });
    expect(session.history.getSnapshot()).toMatchObject({
      busy: false, undoDepth: 0, redoDepth: 0,
    });
    expect(renderer.prepareSelectionSnapshotProjection).toHaveBeenCalledOnce();
    expect(events).toEqual(['activate', 'overlay:0', 'accept']);
    session.dispose();
  });

  it('disposes a prepared result without publishing when its presentation becomes stale', async () => {
    const { session, renderer, events } = setup();
    let current = true;
    vi.mocked(renderer.prepareSelectionShapeProjection).mockImplementationOnce(async (
      _document: DocumentAddress,
      baseline: LightTableCommittedSelection,
      intent: SelectionShapeProjectionIntent,
      id: TransactionId,
    ) => {
      current = false;
      return prepared(baseline, {
        ...baseline,
        revision: (baseline.revision + 1) as SelectionRevision,
        active: true,
        coverage,
        supportBounds: { x: 2, y: 1, width: 5, height: 5 },
        provenance: [intent.provenance],
      }, events, id);
    });
    const service = new SelectionShapeCommandService(session, () => renderer, () => current);

    expect(await service.execute({
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    })).toBe(false);

    expect(events).toEqual(['dispose']);
    expect(session.getSnapshot().editor.selectionRevision).toBe(0);
    expect(session.history.getSnapshot()).toMatchObject({ undoDepth: 0, busy: false });
    expect(renderer.prepareSelectionSnapshotProjection).not.toHaveBeenCalled();
    session.dispose();
  });
});
