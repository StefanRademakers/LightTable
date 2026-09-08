import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentAddress,
  PreparedSelectionProjection,
  SelectionRevision,
  TransactionId,
} from '@lighttable/editor-kernel';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import {
  createMagicWandSelectionOperation,
  createObjectSelectionOperation,
  type SelectionOperation,
} from '../../../editor/selection/selectionTypes';
import type {
  SelectionMagicWandProjectionIntent,
  SelectionShapeProjectionIntent,
} from '../../../editor/rendering/SelectionShapeProjectionService';
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
      intent,
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
    prepareSelectionTranslationProjection: vi.fn(async (
      _document,
      baseline,
      intent,
      id,
    ) => prepared(baseline, {
      ...baseline,
      revision: (baseline.revision + 1) as SelectionRevision,
      provenance: [...baseline.provenance, intent.provenance],
    }, events, id)),
    prepareSelectionPaintProjection: vi.fn(async (
      _document,
      baseline,
      intent,
      id,
    ) => prepared(baseline, {
      ...baseline,
      revision: (baseline.revision + 1) as SelectionRevision,
      active: true,
      coverage,
      supportBounds: { x: 2, y: 1, width: 5, height: 5 },
      provenance: [...baseline.provenance, intent.provenance],
    }, events, id)),
    prepareSelectionMagicWandProjection: vi.fn(async (
      _document,
      baseline,
      intent: SelectionMagicWandProjectionIntent,
      id,
    ) => prepared(baseline, {
      ...baseline,
      revision: (baseline.revision + 1) as SelectionRevision,
      active: true,
      coverage,
      supportBounds: { x: 2, y: 1, width: 5, height: 5 },
      provenance: intent.mode === 'replace'
        ? [intent.provenance]
        : [...baseline.provenance, intent.provenance],
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

  it('commits translation and selection paint through the same reserved history route', async () => {
    const { session, renderer, service } = setup();
    await service.execute({
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    });
    const translated: SelectionOperation = {
      mode: 'transform', shape: operation.shape,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: -4, ty: 2 },
    };
    expect(await service.executeTranslation({ x: -4, y: 2, provenance: translated })).toBe(true);
    const painted: SelectionOperation = {
      mode: 'add', shape: operation.shape,
      source: { kind: 'selection-paint', dabs: [], hardness: 0.5, opacity: 1 },
    };
    expect(await service.executePaint({
      dabs: [{ x: 3, y: 4, size: 10, pressure: 1, flowScale: 1 }],
      hardness: 0.5, opacity: 1, mode: 'add', provenance: painted,
    })).toBe(true);

    expect(renderer.prepareSelectionTranslationProjection).toHaveBeenCalledOnce();
    expect(renderer.prepareSelectionPaintProjection).toHaveBeenCalledOnce();
    expect(session.history.getSnapshot()).toMatchObject({ undoDepth: 3, busy: false });
    expect(session.getSnapshot().editor.selection.at(-1)?.source?.kind).toBe('selection-paint');
    session.dispose();
  });

  it('commits Magic Wand, exact history and undo/redo through the reserved route', async () => {
    const { session, renderer, events, service } = setup();
    const document = session.getSnapshot().document!;
    const point = { x: 4, y: 3 };
    const options = {
      sampleSize: 3 as const,
      tolerance: 18,
      antiAlias: true,
      contiguous: true,
      sampleAllLayers: false,
    };
    const magicWand = createMagicWandSelectionOperation(
      document.activeLayerId!, document.revision, document.width, document.height,
      point, options, 'replace',
    );

    expect(await service.executeMagicWand({
      layerId: document.activeLayerId!, point, options, mode: 'replace',
      provenance: magicWand,
    })).toBe(true);

    expect(renderer.prepareSelectionMagicWandProjection).toHaveBeenCalledOnce();
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 1,
      selection: [magicWand],
      selectionMaskSnapshot: coverage,
      selectionSupportBounds: { x: 2, y: 1, width: 5, height: 5 },
    });
    expect(session.history.getSnapshot()).toMatchObject({
      undoDepth: 1, redoDepth: 0, undoLabel: 'Magic Wand', busy: false,
    });
    expect(events).toEqual(['activate', 'overlay:1', 'accept']);

    expect(await session.history.undo()).toBe(true);
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 2, selection: [], selectionSupportBounds: null,
    });
    expect(await session.history.redo()).toBe(true);
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 3, selection: [magicWand],
      selectionSupportBounds: { x: 2, y: 1, width: 5, height: 5 },
    });
    expect(renderer.prepareSelectionSnapshotProjection).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('commits an inferred raster mask through the same atomic route', async () => {
    const { session, renderer, service } = setup();
    const document = session.getSnapshot().document!;
    const mask = {
      width: document.width,
      height: document.height,
      data: new Uint8Array(document.width * document.height).fill(255),
    };
    const provenance = createObjectSelectionOperation(
      document.revision, document.width, document.height, 'replace',
    );

    expect(await service.executeRasterMask({ mask, mode: 'replace', provenance })).toBe(true);

    expect(renderer.prepareSelectionShapeProjection).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { mask, mode: 'replace', provenance }, expect.anything(), expect.any(AbortSignal),
    );
    expect(session.getSnapshot().editor).toMatchObject({
      selectionRevision: 1, selection: [provenance],
    });
    expect(session.history.getSnapshot()).toMatchObject({ undoDepth: 1, busy: false });
    session.dispose();
  });

  it('rejects stale Object Selection provenance before projection preparation', async () => {
    const { session, renderer, service } = setup();
    const document = session.getSnapshot().document!;
    const mask = {
      width: document.width,
      height: document.height,
      data: new Uint8Array(document.width * document.height).fill(255),
    };
    const stale = createObjectSelectionOperation(
      document.revision - 1, document.width, document.height, 'replace',
    );

    await expect(service.executeRasterMask({ mask, mode: 'replace', provenance: stale }))
      .resolves.toBe(false);
    expect(renderer.prepareSelectionShapeProjection).not.toHaveBeenCalled();
    expect(session.history.getSnapshot().undoDepth).toBe(0);
    session.dispose();
  });

  it('projects the current selection without changing revision or history', async () => {
    const { session, renderer, service } = setup();
    await service.execute({
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    });
    const before = session.getSnapshot().editor.selectionRevision;
    const undoDepth = session.history.getSnapshot().undoDepth;

    expect(await service.projectCurrent(renderer)).toBe(true);

    expect(session.getSnapshot().editor.selectionRevision).toBe(before);
    expect(session.history.getSnapshot().undoDepth).toBe(undoDepth);
    expect(renderer.prepareSelectionSnapshotProjection).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('disposes a rebind projection completed for a renderer that is no longer current', async () => {
    const { session, renderer, events } = setup();
    let release!: () => void;
    let currentRenderer: SelectionProjectionCommandPort | null = renderer;
    vi.mocked(renderer.prepareSelectionSnapshotProjection).mockImplementationOnce(async (
      _document, baseline, target, id,
    ) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return prepared(baseline, target, events, id);
    });
    const service = new SelectionShapeCommandService(
      session,
      () => currentRenderer,
    );

    const projecting = service.projectCurrent(renderer);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    currentRenderer = null;
    release();

    await expect(projecting).resolves.toBe(false);
    expect(events).toEqual(['dispose']);
    expect(session.history.getSnapshot().undoDepth).toBe(0);
    session.dispose();
  });

  it('disposes a rebind projection when a newer selection commits while it prepares', async () => {
    const { session, renderer, events, service } = setup();
    let release!: () => void;
    vi.mocked(renderer.prepareSelectionSnapshotProjection).mockImplementationOnce(async (
      _document, baseline, target, id,
    ) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return prepared(baseline, target, events, id);
    });

    const projecting = service.projectCurrent(renderer);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await service.execute({
      shape: operation.shape, mode: 'replace', featherRadius: 0,
      antiAlias: true, provenance: operation,
    })).toBe(true);
    release();

    await expect(projecting).resolves.toBe(false);
    expect(events).toEqual(['activate', 'overlay:1', 'accept', 'dispose']);
    session.dispose();
  });

  it('leaves the untouched canonical projection and history empty when preparation fails', async () => {
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
    expect(renderer.prepareSelectionSnapshotProjection).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    session.dispose();
  });

  it('disposes a prepared result without publishing when its presentation becomes stale', async () => {
    const { session, renderer, events } = setup();
    let current = true;
    vi.mocked(renderer.prepareSelectionShapeProjection).mockImplementationOnce(async (
      _document: DocumentAddress,
      baseline: LightTableCommittedSelection,
      intent,
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
