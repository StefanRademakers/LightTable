import { describe, expect, it, vi } from 'vitest';
import { addLayerMask } from '../../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { RasterSelectionMask, SelectionOperation, SelectionShape } from '../../../editor/selection/selectionTypes';
import { createSelectionSessionController, type SelectionSessionDependencies } from './useSelectionSessionController';

const document = createImageDocument('Selection', 100, 80, 'selection');
const fullCoverage = () => SelectionMaskSnapshot.fromRaw(
  document.width, document.height,
  new Uint16Array(document.width * document.height).fill(0x3c00),
);

const setup = (overrides: Partial<SelectionSessionDependencies> = {}) => {
  let activeDocument: ImageDocument | null = document;
  let selection: SelectionOperation[] = [];
  let pointerId: number | null = null;
  let draft: SelectionShape | null = null;
  let selectionMaskSnapshot = SelectionMaskSnapshot.inactive(document.width, document.height);
  const restoreSelectionSnapshot = vi.fn(async (snapshot: SelectionMaskSnapshot) => {
    selectionMaskSnapshot = snapshot;
    return true;
  });
  const preview = {
    paintSelectionDabs: vi.fn(async () => true),
    restoreSelectionSnapshot,
    captureSelectionSnapshot: vi.fn(async () => selectionMaskSnapshot),
    measureSelectionBounds: vi.fn(async () => selectionMaskSnapshot.active ? ({
      coreBounds: { x: 0, y: 0, width: document.width, height: document.height },
      supportBounds: { x: 0, y: 0, width: document.width, height: document.height },
      peakCoverage: 1,
    }) : null),
    release: vi.fn(),
  };
  const renderer = {
    setSelectionPreviewProjection: vi.fn(),
    setCommittedSelectionProjection: vi.fn(),
    beginSelectionPaintPreview: vi.fn(() => preview),
  };
  const commitShape = vi.fn(async ({ mode, provenance }: Parameters<SelectionSessionDependencies['commitShape']>[0]) => {
    selection = mode === 'replace' ? [provenance] : [...selection, provenance];
    selectionMaskSnapshot = fullCoverage();
    return true;
  });
  const commitTranslation = vi.fn(async ({ provenance }: Parameters<SelectionSessionDependencies['commitTranslation']>[0]) => {
    selection = [...selection, provenance];
    return true;
  });
  const commitPaint = vi.fn(async ({ provenance }: Parameters<SelectionSessionDependencies['commitPaint']>[0]) => {
    selection = [...selection, provenance];
    selectionMaskSnapshot = fullCoverage();
    return true;
  });
  const commitMagicWand = vi.fn(async ({ mode, provenance }: Parameters<SelectionSessionDependencies['commitMagicWand']>[0]) => {
    selection = mode === 'replace' ? [provenance] : [...selection, provenance];
    selectionMaskSnapshot = fullCoverage();
    return true;
  });
  const commitOperation = vi.fn(async ({ operation }: Parameters<SelectionSessionDependencies['commitOperation']>[0]) => {
    selection = operation === null ? []
      : operation.mode === 'replace' ? [operation] : [...selection, operation];
    selectionMaskSnapshot = operation === null
      ? SelectionMaskSnapshot.inactive(document.width, document.height) : fullCoverage();
    return true;
  });
  const commitRasterMask = vi.fn(async () => true);
  const setError = vi.fn();
  const dependencies: SelectionSessionDependencies = {
    getDocument: () => activeDocument,
    getRenderer: () => renderer,
    getSelection: () => selection,
    getSelectionMaskSnapshot: () => selectionMaskSnapshot,
    getSelectionSupportBounds: () => selectionMaskSnapshot.active
      ? { x: 0, y: 0, width: document.width, height: document.height } : null,
    publishSelection: (next, nextPointerId, nextMask) => {
      selection = next;
      pointerId = nextPointerId;
      if (nextMask !== undefined) selectionMaskSnapshot = nextMask;
    },
    publishPointer: (nextPointerId) => { pointerId = nextPointerId; },
    publishDraft: (next) => { draft = next; },
    setError,
    commitShape,
    commitTranslation,
    commitPaint,
    commitMagicWand,
    commitOperation,
    commitRasterMask,
    ...overrides,
  };
  const controller = createSelectionSessionController(() => dependencies);
  return {
    controller, renderer, preview,
    commitShape, commitTranslation, commitPaint, commitMagicWand, commitOperation,
    commitRasterMask, setError,
    get selection() { return selection; },
    get pointerId() { return pointerId; },
    get draft() { return draft; },
    switchDocument: (next: ImageDocument | null) => { activeDocument = next; },
  };
};

describe('selection session controller kernel boundary', () => {
  it('routes Select All, Invert and Clear through the generic kernel operation port', async () => {
    const state = setup();
    expect(await state.controller.applyState('all')).toBe(true);
    expect(await state.controller.applyState('invert')).toBe(true);
    expect(await state.controller.applyState('clear')).toBe(true);
    expect(state.commitOperation).toHaveBeenCalledTimes(3);
    expect(state.commitOperation.mock.calls[0]![0].operation).toMatchObject({ mode: 'replace' });
    expect(state.commitOperation.mock.calls[1]![0].operation).toMatchObject({ mode: 'invert' });
    expect(state.commitOperation.mock.calls[2]![0].operation).toBeNull();
    expect(state.selection).toEqual([]);
  });

  it('fails closed when a generic committed operation is rejected', async () => {
    const commitOperation = vi.fn(async () => false);
    const state = setup({ commitOperation });
    await expect(state.controller.applyState('all')).resolves.toBe(false);
    expect(state.selection).toEqual([]);
    expect(state.setError).toHaveBeenLastCalledWith('The complete canvas could not be selected.');
  });

  it('routes direct and dragged rectangle selections through commitShape', async () => {
    const state = setup();
    const shape: SelectionShape = {
      kind: 'rectangle', points: [{ x: 10, y: 12 }, { x: 40, y: 42 }],
    };
    await expect(state.controller.applyShape(shape, 'replace', 3, true)).resolves.toBe(true);
    expect(state.controller.begin(7, 'select-rectangle', { x: 2, y: 4 }, 'add')).toBe(true);
    expect(state.controller.move(7, { x: 22, y: 28 })).toBe(true);
    expect(state.controller.finish(7)).toBe(true);
    await state.controller.settle();
    expect(state.commitShape).toHaveBeenCalledTimes(2);
    expect(state.commitShape.mock.calls[0]![0]).toMatchObject({
      mode: 'replace', featherRadius: 3, antiAlias: true,
    });
    expect(state.commitShape.mock.calls[1]![0]).toMatchObject({ mode: 'add' });
    expect(state.pointerId).toBeNull();
    expect(state.draft).toBeNull();
  });

  it('keeps translation as preview state and commits one cumulative kernel translation', async () => {
    const state = setup();
    await state.controller.applyState('all');
    expect(state.controller.begin(3, 'select-rectangle', { x: 20, y: 20 }, 'replace')).toBe(true);
    expect(state.controller.move(3, { x: 25, y: 27 })).toBe(true);
    expect(state.renderer.setSelectionPreviewProjection).toHaveBeenLastCalledWith(
      expect.any(Array), { x: 5, y: 7 },
    );
    expect(state.controller.finish(3)).toBe(true);
    await state.controller.settle();
    expect(state.commitTranslation).toHaveBeenCalledOnce();
    expect(state.commitTranslation.mock.calls[0]![0]).toMatchObject({ x: 5, y: 7 });
  });

  it('cancels translation without publishing a committed mutation', async () => {
    const state = setup();
    await state.controller.applyState('all');
    state.controller.begin(4, 'select-rectangle', { x: 20, y: 20 }, 'replace');
    state.controller.move(4, { x: 35, y: 30 });
    expect(state.controller.cancel(4)).toBe(true);
    expect(state.commitTranslation).not.toHaveBeenCalled();
    expect(state.renderer.setCommittedSelectionProjection).toHaveBeenCalledOnce();
  });

  it('routes edge operations through the generic committed operation port', async () => {
    const state = setup();
    await state.controller.applyState('all');
    await expect(state.controller.feather(4)).resolves.toBe(true);
    await expect(state.controller.border(2)).resolves.toBe(true);
    await expect(state.controller.smooth(3, false)).resolves.toBe(true);
    await expect(state.controller.morphology('expand', 5, true)).resolves.toBe(true);
    expect(state.commitOperation.mock.calls.slice(1).map(([command]) => command.operation?.mode))
      .toEqual(['feather', 'border', 'smooth', 'expand']);
  });

  it('uses exact active coverage instead of semantic provenance for capabilities', async () => {
    const exact = fullCoverage();
    const state = setup({
      getSelection: () => [],
      getSelectionMaskSnapshot: () => exact,
      getSelectionSupportBounds: () => ({
        x: 0, y: 0, width: document.width, height: document.height,
      }),
    });
    expect(state.controller.contains({ x: 20, y: 20 })).toBe(true);
    expect(state.controller.begin(31, 'select-rectangle', { x: 20, y: 20 }, 'replace')).toBe(true);
    state.controller.move(31, { x: 24, y: 25 });
    state.controller.finish(31);
    await state.controller.settle();
    expect(state.commitTranslation).toHaveBeenCalledOnce();
    await expect(state.controller.feather(2)).resolves.toBe(true);
    await expect(state.controller.applyState('clear')).resolves.toBe(true);
  });

  it('routes layer and composite sources through generic operations', async () => {
    const masked = addLayerMask(document, document.activeLayerId!);
    const state = setup({ getDocument: () => masked });
    await expect(state.controller.selectLayerMask(masked.activeLayerId!)).resolves.toBe(true);
    state.controller.selectLayerTransparency(masked.activeLayerId!);
    state.controller.selectCompositeChannel('composite');
    await state.controller.settle();
    expect(state.commitOperation.mock.calls.map(([command]) => command.operation?.source?.kind))
      .toEqual(['layer-mask', 'layer-transparency', 'composite-channel']);
  });

  it('routes Magic Wand and Select Similar through committed kernel ports', async () => {
    const state = setup();
    const options = {
      sampleSize: 3 as const, tolerance: 20, antiAlias: true,
      contiguous: true, sampleAllLayers: false,
    };
    await expect(state.controller.applyMagicWand(
      document.activeLayerId!, { x: 12, y: 14 }, 'replace', options,
    )).resolves.toBe(true);
    await expect(state.controller.selectSimilar(document.activeLayerId!, {
      tolerance: 18, antiAlias: true, sampleAllLayers: false,
    })).resolves.toBe(true);
    expect(state.commitMagicWand).toHaveBeenCalledOnce();
    expect(state.commitOperation.mock.calls[0]![0].operation?.source?.kind).toBe('similar');
  });

  it('routes valid raster masks through commitRasterMask and rejects invalid dimensions', async () => {
    const state = setup();
    const valid: RasterSelectionMask = {
      width: document.width, height: document.height,
      data: new Uint8Array(document.width * document.height),
    };
    await expect(state.controller.rasterMask(valid, 'replace')).resolves.toBe(true);
    await expect(state.controller.rasterMask({ ...valid, width: 99 }, 'replace')).resolves.toBe(false);
    expect(state.commitRasterMask).toHaveBeenCalledOnce();
  });

  it('uses an isolated paint preview and commits after restoring its exact baseline', async () => {
    const state = setup();
    await state.controller.applyState('all');
    expect(state.controller.beginPaint(8, { x: 12, y: 14, pressure: 1 }, 'add', {
      size: 20, hardness: 0.8, opacity: 0.7, smooth: 0.4,
    })).toBe(true);
    expect(state.controller.movePaint(8, [{ x: 18, y: 20, pressure: 1 }])).toBe(true);
    expect(state.controller.finishPaint(8)).toBe(true);
    await state.controller.settle();
    expect(state.preview.paintSelectionDabs).toHaveBeenCalled();
    expect(state.preview.restoreSelectionSnapshot).toHaveBeenCalledOnce();
    expect(state.preview.release).toHaveBeenCalledOnce();
    expect(state.commitPaint).toHaveBeenCalledOnce();
  });

  it('fails closed when exact paint preview ownership is unavailable', () => {
    const state = setup({
      getSelectionMaskSnapshot: () => fullCoverage(),
      getRenderer: () => ({
        setSelectionPreviewProjection: vi.fn(),
        setCommittedSelectionProjection: vi.fn(),
        beginSelectionPaintPreview: () => null,
      }),
    });
    expect(state.controller.beginPaint(9, { x: 2, y: 2, pressure: 1 }, 'add', {
      size: 10, hardness: 1, opacity: 1, smooth: 0,
    })).toBe(false);
    expect(state.commitPaint).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenLastCalledWith('The selection paint preview is unavailable.');
  });

  it('does not let a gesture commit after the document snapshot changes', async () => {
    const state = setup();
    state.controller.begin(11, 'select-rectangle', { x: 1, y: 1 }, 'replace');
    state.controller.move(11, { x: 20, y: 20 });
    state.switchDocument({ ...document, revision: document.revision + 1 });
    state.controller.finish(11);
    await state.controller.settle();
    expect(state.commitShape).not.toHaveBeenCalled();
  });
});
