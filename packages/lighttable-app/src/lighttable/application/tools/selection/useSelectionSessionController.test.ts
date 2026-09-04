import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type ImageDocument
} from '../../../editor/document/documentTypes';
import { addLayerMask } from '../../../editor/document/documentCommands';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { SelectionShape } from '../../../editor/selection/selectionTypes';
import {
  createSelectionSessionController,
  type SelectionHistoryEntry,
  type SelectionSessionDependencies
} from './useSelectionSessionController';

const document = createImageDocument('Selection', 100, 80, 'selection');

const setup = (overrides: Partial<SelectionSessionDependencies> = {}) => {
  let activeDocument: ImageDocument | null = document;
  let selection: SelectionOperation[] = [];
  let pointerId: number | null = null;
  let draft: SelectionShape | null = null;
  let draftPublications = 0;
  const history: SelectionHistoryEntry[] = [];
  const renderer = {
    replaceSelection: vi.fn(async () => true),
    setSelection: vi.fn(async () => true),
    clearSelection: vi.fn(),
    transformSelection: vi.fn(async () => true),
    applyMagicWand: vi.fn(async (_operation: SelectionOperation) => true),
    applySelectSimilar: vi.fn(async (_operation: SelectionOperation) => true),
    applyRasterSelection: vi.fn(async (_operation: SelectionOperation) => true),
    paintSelectionDabs: vi.fn(() => true)
  };
  const dependencies: SelectionSessionDependencies = {
    getDocument: () => activeDocument,
    getRenderer: () => renderer,
    getSelection: () => selection,
    publishSelection: (next, nextPointerId) => {
      selection = next;
      pointerId = nextPointerId;
    },
    publishDraft: (next) => {
      draft = next;
      draftPublications += 1;
    },
    pushHistoryEntry: (entry) => history.push(entry),
    setError: vi.fn(),
    ...overrides
  };
  const controller = createSelectionSessionController(() => dependencies);
  return {
    controller,
    renderer,
    history,
    get selection() { return selection; },
    get pointerId() { return pointerId; },
    get draft() { return draft; },
    get draftPublications() { return draftPublications; },
    switchDocument: (next: ImageDocument | null) => {
      activeDocument = next;
    }
  };
};

describe('selection session controller', () => {
  it('applies all, invert and clear through one selection-only owner', async () => {
    const state = setup();
    expect(await state.controller.applyState('all')).toBe(true);
    expect(state.selection).toHaveLength(1);
    expect(await state.controller.applyState('invert')).toBe(true);
    expect(state.selection.at(-1)?.mode).toBe('invert');
    expect(await state.controller.applyState('clear')).toBe(true);
    expect(state.selection).toEqual([]);
    expect(state.renderer.replaceSelection).toHaveBeenCalledTimes(3);
    expect(state.history).toHaveLength(3);
    expect(state.history.every(({ documentMutation }) => documentMutation === false)).toBe(true);

    await state.history.at(-1)?.undo();
    expect(state.selection.at(-1)?.mode).toBe('invert');
    await state.history.at(-1)?.redo();
    expect(state.selection).toEqual([]);
  });

  it('returns the asynchronous feather commit and records selection-only history', async () => {
    const state = setup();
    await state.controller.applyState('all');

    await expect(state.controller.feather(18)).resolves.toBe(true);

    expect(state.selection.at(-1)).toMatchObject({ mode: 'feather', amount: 18 });
    expect(state.renderer.replaceSelection).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ mode: 'feather', amount: 18 })])
    );
    expect(state.history.at(-1)?.documentMutation).toBe(false);
  });

  it('adds Select Similar through the raster selection owner and labels its history', async () => {
    const state = setup();
    expect(await state.controller.selectSimilar(document.activeLayerId!, {
      tolerance: 20, antiAlias: true, sampleAllLayers: false
    })).toBe(false);
    await state.controller.applyState('all');

    await expect(state.controller.selectSimilar(document.activeLayerId!, {
      tolerance: 20, antiAlias: true, sampleAllLayers: false
    })).resolves.toBe(true);

    expect(state.renderer.applySelectSimilar).toHaveBeenCalledOnce();
    expect(state.selection.at(-1)?.source).toMatchObject({
      kind: 'similar', layerId: document.activeLayerId,
      options: { tolerance: 20, antiAlias: true, sampleAllLayers: false }
    });
    expect(state.history.at(-1)).toMatchObject({
      label: 'Select Similar', type: 'selection.similar', documentMutation: false
    });
  });

  it('applies one final semantic shape without replaying pointer samples', async () => {
    const state = setup();
    expect(await state.controller.applyShape(
      { kind: 'rectangle', points: [{ x: 12, y: 14 }, { x: 52, y: 64 }] },
      'replace',
      3,
      true
    )).toBe(true);
    expect(state.renderer.setSelection).toHaveBeenCalledOnce();
    expect(state.renderer.setSelection).toHaveBeenCalledWith(
      { kind: 'rectangle', points: [{ x: 12, y: 14 }, { x: 52, y: 64 }] },
      'replace',
      3,
      true
    );
    expect(state.selection).toEqual([{
      mode: 'replace', amount: 3, antiAlias: true,
      shape: { kind: 'rectangle', points: [{ x: 12, y: 14 }, { x: 52, y: 64 }] }
    }]);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].documentMutation).toBe(false);
  });

  it('publishes one pointer gesture and one selection-only history entry', async () => {
    const onShapeCommitted = vi.fn();
    const state = setup({ onShapeCommitted });
    expect(state.controller.begin(7, 'select-rectangle', { x: 10, y: 10 }, 'replace')).toBe(true);
    expect(state.pointerId).toBe(7);
    expect(state.controller.move(7, { x: 40, y: 50 })).toBe(true);
    expect(state.controller.finish(7)).toBe(true);
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledOnce();
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].documentMutation).toBe(false);
    expect(state.pointerId).toBeNull();
    expect(state.draft).toBeNull();
    expect(onShapeCommitted).toHaveBeenCalledOnce();
    expect(onShapeCommitted).toHaveBeenCalledWith({
      mode: 'replace',
      shape: { kind: 'rectangle', points: [{ x: 10, y: 10 }, { x: 40, y: 50 }] },
      featherRadius: 0,
      antiAlias: false
    });
  });

  it('does not report command-driven shape playback as a new UI commit', async () => {
    const onShapeCommitted = vi.fn();
    const state = setup({ onShapeCommitted });
    expect(await state.controller.applyShape(
      { kind: 'rectangle', points: [{ x: 1, y: 2 }, { x: 20, y: 30 }] },
      'replace', 0, false
    )).toBe(true);
    expect(onShapeCommitted).not.toHaveBeenCalled();
  });

  it('feathers only the newly rasterized marquee before combining it', async () => {
    const state = setup();
    expect(state.controller.begin(
      17,
      'select-ellipse',
      { x: 10, y: 10 },
      'add',
      undefined,
      0,
      48,
      { style: 'fixed', width: 30, height: 20, featherRadius: 8 }
    )).toBe(true);
    expect(state.controller.finish(17)).toBe(true);
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledWith({
      kind: 'ellipse',
      points: [{ x: 10, y: 10 }, { x: 40, y: 30 }]
    }, 'add', 8);
    expect(state.selection).toEqual([{
      mode: 'add',
      amount: 8,
      shape: {
        kind: 'ellipse',
        points: [{ x: 10, y: 10 }, { x: 40, y: 30 }]
      }
    }]);
    expect(state.history).toHaveLength(1);
  });

  it('commits captured lasso feather and anti-alias as one replayable source', async () => {
    const state = setup();
    expect(state.controller.begin(
      18,
      'select-free',
      { x: 0, y: 0 },
      'replace',
      undefined,
      0,
      48,
      undefined,
      { featherRadius: 5, antiAlias: true }
    )).toBe(true);
    state.controller.moveMany(18, [
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 }
    ]);
    expect(state.controller.finish(18)).toBe(true);
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'free' }),
      'replace',
      5,
      true
    );
    expect(state.selection).toHaveLength(1);
    expect(state.selection[0]).toMatchObject({
      mode: 'replace',
      amount: 5,
      antiAlias: true,
      shape: { kind: 'free' }
    });
    expect(state.history).toHaveLength(1);
  });

  it('publishes one draft for a coalesced free-selection batch', () => {
    const state = setup();
    expect(state.controller.begin(9, 'select-free', { x: 0, y: 0 }, 'replace')).toBe(true);
    const initialDraft = state.draftPublications;
    expect(state.controller.moveMany(9, [
      { x: 3, y: 0 },
      { x: 6, y: 1 },
      { x: 9, y: 2 }
    ])).toBe(true);
    expect(state.draftPublications).toBe(initialDraft + 1);
    expect(state.draft?.points).toHaveLength(4);
  });

  it('uses the configured strip thickness against the current document bounds', async () => {
    const state = setup();
    expect(state.controller.begin(
      8,
      'select-horizontal',
      { x: 50, y: 20 },
      'replace',
      5
    )).toBe(true);
    expect(state.draft).toEqual({
      kind: 'rectangle',
      points: [{ x: 0, y: 18 }, { x: 100, y: 23 }]
    });
    expect(state.controller.finish(8)).toBe(true);
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledWith({
      kind: 'rectangle',
      points: [{ x: 0, y: 18 }, { x: 100, y: 23 }]
    }, 'replace');
  });

  it('moves a selection outline without touching layer pixels', async () => {
    const state = setup();
    state.controller.selectAll();
    await Promise.resolve();
    const historyBefore = state.history.length;

    state.controller.translate(10, -1);
    await state.controller.settle();

    expect(state.renderer.transformSelection).toHaveBeenCalledWith({
      a: 1, b: 0, c: 0, d: 1, tx: 10, ty: -1
    });
    expect(state.selection.at(-1)).toMatchObject({
      mode: 'transform',
      transform: { tx: 10, ty: -1 }
    });
    expect(state.history).toHaveLength(historyBefore + 1);
  });

  it('serializes rapid selection nudges without losing operation state', async () => {
    const state = setup();
    state.controller.selectAll();
    await Promise.resolve();

    state.controller.translate(0, -10);
    state.controller.translate(0, -10);
    state.controller.translate(0, -10);
    await state.controller.settle();

    expect(state.renderer.transformSelection).toHaveBeenCalledTimes(3);
    expect(state.selection.slice(-3).map(({ transform }) => transform?.ty)).toEqual([
      -10, -10, -10
    ]);
  });

  it('drags inside a geometric selection as one selection-only history edit', async () => {
    const state = setup();
    state.controller.begin(1, 'select-rectangle', { x: 10, y: 10 }, 'replace');
    state.controller.move(1, { x: 40, y: 40 });
    state.controller.finish(1);
    await Promise.resolve();
    const historyBefore = state.history.length;

    expect(state.controller.begin(2, 'select-rectangle', { x: 20, y: 20 }, 'replace')).toBe(true);
    expect(state.controller.move(2, { x: 27, y: 24 })).toBe(true);
    expect(state.controller.finish(2)).toBe(true);

    expect(state.renderer.transformSelection).toHaveBeenLastCalledWith({
      a: 1, b: 0, c: 0, d: 1, tx: 7, ty: 4
    });
    expect(state.selection.at(-1)?.transform).toMatchObject({ tx: 7, ty: 4 });
    expect(state.history).toHaveLength(historyBefore + 1);
  });

  it('snaps a dragged selection from its retained bounds', async () => {
    const feedback = vi.fn();
    const state = setup({
      getSnapContext: () => ({
        enabled: true,
        zoom: 1,
        targets: [{ axis: 'x', position: 40, source: 'guide', role: 'line' }]
      }),
      publishSnapFeedback: feedback
    });
    state.controller.begin(1, 'select-rectangle', { x: 10, y: 10 }, 'replace');
    state.controller.move(1, { x: 30, y: 30 });
    state.controller.finish(1);
    await Promise.resolve();

    state.controller.begin(2, 'select-rectangle', { x: 20, y: 20 }, 'replace');
    state.controller.move(2, { x: 27, y: 20 });
    expect(state.renderer.transformSelection).toHaveBeenLastCalledWith({
      a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0
    });
    expect(feedback).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ axis: 'x' })
    ]), expect.objectContaining({ x: 20 }));
    state.controller.cancel(2);
  });

  it('snaps a newly drawn rectangular marquee endpoint to guides', () => {
    const feedback = vi.fn();
    const state = setup({
      getSnapContext: () => ({
        enabled: true,
        zoom: 2,
        targets: [
          { axis: 'x', position: 40, source: 'guide', role: 'line' },
          { axis: 'y', position: 55, source: 'guide', role: 'line' }
        ]
      }),
      publishSnapFeedback: feedback
    });

    state.controller.begin(1, 'select-rectangle', { x: 10, y: 10 }, 'replace');
    state.controller.move(1, { x: 37, y: 52 });

    expect(state.draft).toEqual({
      kind: 'rectangle',
      points: [{ x: 10, y: 10 }, { x: 40, y: 55 }]
    });
    expect(feedback).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ axis: 'x', deltaScreen: 6 }),
        expect.objectContaining({ axis: 'y', deltaScreen: 6 })
      ]),
      { x: 10, y: 10, width: 30, height: 45 }
    );
  });

  it('limits row and column marquee snapping to their movable axis', () => {
    const state = setup({
      getSnapContext: () => ({
        enabled: true,
        zoom: 1,
        targets: [
          { axis: 'x', position: 52, source: 'guide', role: 'line' },
          { axis: 'y', position: 22, source: 'guide', role: 'line' }
        ]
      })
    });

    state.controller.begin(1, 'select-horizontal', { x: 50, y: 10 }, 'replace', 1);
    state.controller.move(1, { x: 50, y: 20 });
    expect(state.draft?.points).toEqual([{ x: 0, y: 22 }, { x: 100, y: 23 }]);
  });

  it('does not publish an async result after switching documents', async () => {
    let resolveSelection!: (applied: boolean) => void;
    const state = setup();
    state.renderer.setSelection.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveSelection = resolve; })
    );
    state.controller.begin(3, 'select-rectangle', { x: 1, y: 1 }, 'replace');
    state.controller.move(3, { x: 20, y: 20 });
    state.controller.finish(3);
    state.switchDocument(createImageDocument('Other', 100, 80, 'other'));
    resolveSelection(true);
    await Promise.resolve();
    expect(state.selection).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });

  it('restores command-driven selection through history', async () => {
    const state = setup();
    state.controller.selectAll();
    await Promise.resolve();
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    await state.history[0].undo();
    expect(state.selection).toHaveLength(0);
    await state.history[0].redo();
    expect(state.selection).toHaveLength(1);
  });

  it('loads a layer mask as a raster-backed selection', async () => {
    const state = setup();
    const masked = addLayerMask(document, document.activeLayerId!);
    state.switchDocument(masked);

    state.controller.selectLayerMask(masked.activeLayerId!);
    await Promise.resolve();

    expect(state.renderer.replaceSelection).toHaveBeenCalledWith([
      expect.objectContaining({
        mode: 'replace',
        source: expect.objectContaining({
          kind: 'layer-mask',
          layerId: masked.activeLayerId
        })
      })
    ]);
    expect(state.selection[0]?.source?.kind).toBe('layer-mask');
    expect(state.history).toHaveLength(1);
  });

  it('loads raster layer transparency as a replayable selection source', async () => {
    const state = setup();

    state.controller.selectLayerTransparency(document.activeLayerId!);
    await Promise.resolve();

    expect(state.renderer.replaceSelection).toHaveBeenCalledWith([
      expect.objectContaining({
        mode: 'replace',
        source: expect.objectContaining({
          kind: 'layer-transparency',
          layerId: document.activeLayerId,
          contentRevision: expect.any(String)
        })
      })
    ]);
    expect(state.selection[0]?.source?.kind).toBe('layer-transparency');
    expect(state.history).toHaveLength(1);
  });

  it('keeps a polygon draft across clicks and commits it near the origin', async () => {
    const state = setup();
    expect(state.controller.polygonClick(
      { x: 10, y: 10 },
      5,
      'replace'
    )).toBe(true);
    state.controller.polygonMove({ x: 40, y: 10 });
    state.controller.polygonClick(
      { x: 40, y: 10 },
      5,
      'replace'
    );
    state.controller.polygonClick(
      { x: 40, y: 40 },
      5,
      'replace'
    );
    expect(state.controller.polygonActive).toBe(true);
    state.controller.polygonClick(
      { x: 12, y: 12 },
      5,
      'replace'
    );
    await Promise.resolve();
    expect(state.renderer.setSelection).toHaveBeenCalledWith(
      {
        kind: 'polygon',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 10 },
          { x: 40, y: 40 }
        ]
      },
      'replace'
    );
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.controller.polygonActive).toBe(false);
  });

  it('commits one replayable Magic Wand operation through shared selection history', async () => {
    const onMagicWandCommitted = vi.fn();
    const state = setup({ onMagicWandCommitted });
    const pointerPoint = { x: 12.5, y: 8.25, pressure: 0.7 };
    expect(state.controller.magicWand(
      pointerPoint,
      'replace',
      { sampleSize: 5, tolerance: 20, antiAlias: true, contiguous: true, sampleAllLayers: false }
    )).toBe(true);
    await Promise.resolve();

    expect(state.renderer.applyMagicWand).toHaveBeenCalledOnce();
    const operation = state.renderer.applyMagicWand.mock.calls[0]![0];
    expect(operation).toMatchObject({
      mode: 'replace',
      source: {
        kind: 'magic-wand',
        point: { x: 12.5, y: 8.25 },
        options: { sampleSize: 5, tolerance: 20, contiguous: true }
      }
    });
    expect(state.selection).toEqual([operation]);
    expect(state.history).toHaveLength(1);
    expect(onMagicWandCommitted).toHaveBeenCalledWith({
      kind: 'magic-wand',
      layerId: document.activeLayerId,
      point: { x: 12.5, y: 8.25 },
      mode: 'replace',
      options: { sampleSize: 5, tolerance: 20, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    });

    await state.history[0]!.undo();
    await state.history[0]!.redo();
    expect(state.renderer.replaceSelection).toHaveBeenNthCalledWith(1, []);
    expect(state.renderer.replaceSelection).toHaveBeenNthCalledWith(2, [operation]);
  });

  it('awaits direct Magic Wand execution without publishing a second UI observation', async () => {
    const onMagicWandCommitted = vi.fn();
    const state = setup({ onMagicWandCommitted });
    await expect(state.controller.applyMagicWand(
      document.activeLayerId!,
      { x: 16, y: 24 },
      'add',
      { sampleSize: 3, tolerance: 12, antiAlias: false,
        contiguous: false, sampleAllLayers: true }
    )).resolves.toBe(true);
    expect(state.selection).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(onMagicWandCommitted).not.toHaveBeenCalled();
    await expect(state.controller.applyMagicWand(
      'missing-layer' as never,
      { x: 1, y: 1 },
      'replace',
      { sampleSize: 1, tolerance: 20, antiAlias: true,
        contiguous: true, sampleAllLayers: false }
    )).resolves.toBe(false);
  });

  it('commits an immutable raster mask through the normal selection history path', async () => {
    const state = setup();
    const mask = {
      width: document.width,
      height: document.height,
      data: new Uint8Array(document.width * document.height)
    };
    mask.data[12] = 255;
    await expect(state.controller.rasterMask(mask, 'replace')).resolves.toBe(true);

    expect(state.renderer.applyRasterSelection).toHaveBeenCalledOnce();
    const operation = state.renderer.applyRasterSelection.mock.calls[0]![0];
    expect(operation).toMatchObject({
      mode: 'replace',
      source: { kind: 'raster-mask', documentRevision: document.revision, mask }
    });
    expect(state.selection).toEqual([operation]);
    expect(state.history).toHaveLength(1);

    await state.history[0]!.undo();
    await state.history[0]!.redo();
    expect(state.renderer.replaceSelection).toHaveBeenNthCalledWith(1, []);
    expect(state.renderer.replaceSelection).toHaveBeenNthCalledWith(2, [operation]);
  });

  it('publishes only the newest Magic Wand result while preserving queued add operations', async () => {
    const state = setup();
    let resolveFirst!: (applied: boolean) => void;
    let resolveSecond!: (applied: boolean) => void;
    state.renderer.applyMagicWand
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveSecond = resolve; }));
    const options = {
      sampleSize: 1 as const,
      tolerance: 20,
      antiAlias: true,
      contiguous: true,
      sampleAllLayers: false
    };

    state.controller.magicWand({ x: 10, y: 10 }, 'replace', options);
    state.controller.magicWand({ x: 20, y: 20 }, 'add', options);
    resolveFirst(true);
    await Promise.resolve();
    expect(state.selection).toEqual([]);
    resolveSecond(true);
    await Promise.resolve();

    expect(state.selection).toHaveLength(2);
    expect(state.selection.map((operation) => operation.source?.kind === 'magic-wand'
      ? operation.source.point
      : null)).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(state.history).toHaveLength(2);
  });

  it('invalidates and restores the selection when Magic Wand work is cancelled', async () => {
    const state = setup();
    let resolveWand!: (applied: boolean) => void;
    state.renderer.applyMagicWand.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolveWand = resolve; })
    );
    state.controller.magicWand({ x: 10, y: 10 }, 'replace', {
      sampleSize: 1,
      tolerance: 20,
      antiAlias: true,
      contiguous: true,
      sampleAllLayers: false
    });

    state.controller.reset();
    expect(state.renderer.replaceSelection).toHaveBeenCalledWith([]);
    resolveWand(true);
    await Promise.resolve();

    expect(state.selection).toEqual([]);
    expect(state.history).toEqual([]);
  });
});
