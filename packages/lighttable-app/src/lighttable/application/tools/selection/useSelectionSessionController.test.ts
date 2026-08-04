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

const setup = () => {
  let activeDocument: ImageDocument | null = document;
  let selection: SelectionOperation[] = [];
  let pointerId: number | null = null;
  let draft: SelectionShape | null = null;
  const history: SelectionHistoryEntry[] = [];
  const renderer = {
    replaceSelection: vi.fn(async () => true),
    setSelection: vi.fn(async () => true),
    clearSelection: vi.fn(),
    transformSelection: vi.fn(async () => true)
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
    },
    pushHistoryEntry: (entry) => history.push(entry),
    setError: vi.fn()
  };
  const controller = createSelectionSessionController(() => dependencies);
  return {
    controller,
    renderer,
    history,
    get selection() { return selection; },
    get pointerId() { return pointerId; },
    get draft() { return draft; },
    switchDocument: (next: ImageDocument | null) => {
      activeDocument = next;
    }
  };
};

describe('selection session controller', () => {
  it('publishes one pointer gesture and one selection-only history entry', async () => {
    const state = setup();
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
    await Promise.resolve();

    expect(state.renderer.transformSelection).toHaveBeenCalledWith({
      a: 1, b: 0, c: 0, d: 1, tx: 10, ty: -1
    });
    expect(state.selection.at(-1)).toMatchObject({
      mode: 'transform',
      transform: { tx: 10, ty: -1 }
    });
    expect(state.history).toHaveLength(historyBefore + 1);
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
          pixelRevision: expect.any(Number)
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
});
