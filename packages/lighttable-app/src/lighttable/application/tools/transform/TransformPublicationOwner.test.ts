import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { DocumentMutationTransaction } from '../../documents/useDocumentMutationController';
import {
  TransformPublicationOwner,
  type TransformPublicationDependencies,
  type TransformPublicationHistoryEntry,
  type TransformPublicationRenderer
} from './TransformPublicationOwner';

const transaction = (before: ReturnType<typeof createImageDocument>) => {
  let current = before;
  let active = true;
  return {
    documentId: before.id,
    owner: 'transform',
    before,
    get current() { return current; },
    get active() { return active; },
    stage: vi.fn((mutate) => {
      if (!active) return false;
      current = mutate(current);
      return true;
    }),
    change: vi.fn(() => false),
    commit: vi.fn(() => { active = false; return true; }),
    commitWith: vi.fn((commit) => { active = false; return commit(before, current); }),
    commitWithAsync: vi.fn(async (commit) => {
      const committed = await commit(before, current);
      if (committed) active = false;
      return committed;
    }),
    cancel: vi.fn(() => { active = false; return true; })
  } as DocumentMutationTransaction;
};

const selection = (x: number): SelectionOperation[] => [{
  mode: 'replace',
  shape: { kind: 'rectangle', points: [{ x, y: 1 }, { x: x + 4, y: 5 }] },
  amount: 0,
  antiAlias: false
}];

const fixture = () => {
  const before = createImageDocument('Transform publication', 16, 12, 'source');
  const after = { ...before, revision: before.revision + 1 };
  const beforeSelection = selection(1);
  const afterSelection = selection(3);
  const beforeMask = SelectionMaskSnapshot.inactive(16, 12);
  const afterMask = SelectionMaskSnapshot.inactive(16, 12);
  let document = before;
  let currentSelection = beforeSelection;
  let currentMask = beforeMask;
  let pixelsApplied = true;
  let rendererGeneration = 1;
  let selectionRevision = 0;
  const destroy = vi.fn();
  const edit: ReversiblePixelEdit = {
    byteSize: 64,
    undo: () => true,
    redo: () => true,
    destroy
  };
  const renderer: TransformPublicationRenderer = {
    applyPixelHistory: vi.fn((_edit, direction) => {
      if (pixelsApplied !== (direction === 'undo')) return false;
      pixelsApplied = direction === 'redo';
      return true;
    }),
    captureSelectionSnapshot: vi.fn(async () => afterMask),
    restoreSelectionSnapshot: vi.fn(async () => true)
  };
  const history: TransformPublicationHistoryEntry[] = [];
  const dependencies: TransformPublicationDependencies = {
    getDocument: () => document,
    getRenderer: () => renderer,
    getRendererGeneration: () => rendererGeneration,
    getSelection: () => currentSelection,
    getSelectionRevision: () => selectionRevision,
    getSelectionMaskSnapshot: () => currentMask,
    applyDocumentSnapshot: (next) => { document = next; },
    applyDocumentAndSelection: async (next, nextSelection, nextMask) => {
      document = next;
      currentSelection = nextSelection;
      currentMask = nextMask;
      selectionRevision += 1;
    },
    pushHistoryEntry: (entry) => { history.push(entry); },
    setError: vi.fn(),
    onRasterTransformCommitted: vi.fn()
  };
  return {
    before, after, beforeSelection, afterSelection, beforeMask, afterMask,
    edit, renderer, history, dependencies, destroy,
    pixelsApplied: () => pixelsApplied,
    document: () => document,
    currentSelection: () => currentSelection,
    currentMask: () => currentMask,
    selectionRevision: () => selectionRevision,
    setSelectionRevision: (revision: number) => { selectionRevision = revision; },
    setRendererGeneration: (generation: number) => { rendererGeneration = generation; }
  };
};

describe('TransformPublicationOwner', () => {
  it('publishes selected pixels, document, selection and history as one reversible result', async () => {
    const state = fixture();
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!, pixelEdit: state.edit
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelection: state.beforeSelection,
      openingSelectionRevision: 0,
      openingSelectionMask: state.beforeMask
    });

    expect(state.document()).toBe(state.after);
    expect(state.currentSelection()).toBe(state.afterSelection);
    expect(state.currentMask()).toBe(state.afterMask);
    expect(state.history).toHaveLength(1);
    expect(state.selectionRevision()).toBe(1);
    expect(state.dependencies.onRasterTransformCommitted).toHaveBeenCalledWith(
      state.before.activeLayerId, 'selection'
    );

    await state.history[0].undo();
    expect({ document: state.document(), selection: state.currentSelection(), pixels: state.pixelsApplied() })
      .toEqual({ document: state.before, selection: state.beforeSelection, pixels: false });
    expect(state.selectionRevision()).toBe(2);
    await state.history[0].redo();
    expect({ document: state.document(), selection: state.currentSelection(), pixels: state.pixelsApplied() })
      .toEqual({ document: state.after, selection: state.afterSelection, pixels: true });
    expect(state.selectionRevision()).toBe(3);
  });

  it('refuses history pixel swaps after renderer generation replacement', async () => {
    const state = fixture();
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!, pixelEdit: state.edit
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelection: state.beforeSelection,
      openingSelectionRevision: 0,
      openingSelectionMask: state.beforeMask
    });
    state.setRendererGeneration(2);

    await expect(state.history[0].undo()).rejects.toThrow('target pixel state is unavailable');
    expect({ document: state.document(), pixels: state.pixelsApplied() })
      .toEqual({ document: state.after, pixels: true });
  });

  it('rejects a renderer-generation rebind without addressing its replacement', async () => {
    const state = fixture();
    state.renderer.captureSelectionSnapshot = vi.fn(async () => {
      state.setRendererGeneration(2);
      return state.afterMask;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!, pixelEdit: state.edit
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelection: state.beforeSelection,
      openingSelectionRevision: 0,
      openingSelectionMask: state.beforeMask
    });

    expect(state.pixelsApplied()).toBe(true);
    expect(state.renderer.applyPixelHistory).not.toHaveBeenCalled();
    expect(state.destroy).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(0);
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'The document changed while the transform was finishing; the transform was rolled back.'
    );
  });

  it('rejects a logically newer selection even when object identities are reused', async () => {
    const state = fixture();
    state.renderer.captureSelectionSnapshot = vi.fn(async () => {
      state.setSelectionRevision(1);
      return state.afterMask;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!, pixelEdit: state.edit
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelection: state.beforeSelection,
      openingSelectionRevision: 0,
      openingSelectionMask: state.beforeMask
    });

    expect(state.pixelsApplied()).toBe(false);
    expect(state.history).toHaveLength(0);
    expect(state.destroy).toHaveBeenCalledOnce();
  });

  it('quarantines failed compound rollback and retries from a known applied side', async () => {
    const state = fixture();
    let rejectBefore = true;
    const publish = state.dependencies.applyDocumentAndSelection;
    state.dependencies.applyDocumentAndSelection = async (document, nextSelection, mask, binding) => {
      if (document === state.before && rejectBefore) throw new Error('restore before failed');
      await publish(document, nextSelection, mask, binding);
    };
    state.dependencies.pushHistoryEntry = () => { throw new Error('history failed'); };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!, pixelEdit: state.edit
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelection: state.beforeSelection,
      openingSelectionRevision: 0,
      openingSelectionMask: state.beforeMask
    })).rejects.toThrow('history failed');

    expect({ document: state.document(), pixels: state.pixelsApplied(), blocked: owner.selectionRollback.blocked })
      .toEqual({ document: state.after, pixels: true, blocked: true });
    expect(state.destroy).not.toHaveBeenCalled();

    rejectBefore = false;
    await expect(owner.recover()).resolves.toBe(true);
    expect({ document: state.document(), pixels: state.pixelsApplied(), blocked: owner.selectionRollback.blocked })
      .toEqual({ document: state.before, pixels: false, blocked: false });
    expect(state.destroy).toHaveBeenCalledOnce();
  });
});
