import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { LightTableSelectionReadLease } from '../selection/DocumentSelectionStateStore';
import type { DocumentMutationTransaction } from '../../documents/useDocumentMutationController';
import {
  TransformPublicationOwner,
  type TransformPublicationDependencies,
  type TransformPublicationHistoryEntry,
  type TransformPublicationRenderer
} from './TransformPublicationOwner';
import { TransformSelectionPublicationError } from './publishTransformDocumentSelection';

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
    project: vi.fn(() => true),
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
  let pixelsApplied = false;
  let rendererGeneration = 1;
  let documentSessionId = 'transform-test' as LightTableSelectionReadLease['document']['sessionId'];
  let selectionRevision = 0;
  const destroy = vi.fn();
  const edit: ReversiblePixelEdit = {
    byteSize: 64,
    undo: () => true,
    redo: () => true,
    destroy
  };
  const renderer: TransformPublicationRenderer = {
    publishTransformState: async (publish) => { publish(); },
    applyPixelHistory: vi.fn((_edit, direction) => {
      if (pixelsApplied !== (direction === 'undo')) return false;
      pixelsApplied = direction === 'redo';
      return true;
    }),
    commitLayerTransform: vi.fn(() => {
      pixelsApplied = true;
      return edit;
    }),
    cancelLayerTransform: vi.fn(() => {
      pixelsApplied = false;
    }),
    captureTransformSelectionPreview: vi.fn(async () => afterMask),
  };
  const history: TransformPublicationHistoryEntry[] = [];
  const selectionLease = (): LightTableSelectionReadLease => ({
    document: {
      sessionId: documentSessionId,
      revision: document.revision as LightTableSelectionReadLease['document']['revision']
    },
    selection: {
      documentSessionId,
      revision: selectionRevision as LightTableSelectionReadLease['selection']['revision'],
      canvas: { width: document.width, height: document.height },
      active: currentMask.active,
      coverage: currentMask,
      supportBounds: currentMask.measureBounds()?.supportBounds ?? null,
      provenance: currentSelection
    }
  });
  const dependencies: TransformPublicationDependencies = {
    getDocument: () => document,
    getRenderer: () => renderer,
    getRendererGeneration: () => rendererGeneration,
    getSelectionLease: selectionLease,
    applyDocumentSnapshot: (next) => { document = next; },
    applyDocumentAndSelection: async (next, nextSelection, nextMask, binding) => {
      binding.publishPixels();
      document = next;
      currentSelection = nextSelection;
      currentMask = nextMask;
      selectionRevision += 1;
    },
    reserveHistoryEntry: (entry) => {
      let active = true;
      return {
        commit: () => {
          if (!active) return false;
          active = false;
          history.push(entry);
          return true;
        },
        cancel: () => { active = false; }
      };
    },
    setError: vi.fn()
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
    setRendererGeneration: (generation: number) => { rendererGeneration = generation; },
    setDocumentSessionId: (sessionId: string) => {
      documentSessionId = sessionId as LightTableSelectionReadLease['document']['sessionId'];
    },
    selectionLease
  };
};

describe('TransformPublicationOwner', () => {
  it('keeps live pixels untouched throughout delayed preview capture and publication admission', async () => {
    const state = fixture();
    let finishCapture!: (mask: SelectionMaskSnapshot) => void;
    let admitPublication!: () => void;
    state.renderer.captureTransformSelectionPreview = () => new Promise((resolve) => { finishCapture = resolve; });
    const publish = state.dependencies.applyDocumentAndSelection;
    state.dependencies.applyDocumentAndSelection = async (...args) => {
      await new Promise<void>((resolve) => { admitPublication = resolve; });
      await publish(...args);
    };
    const owner = new TransformPublicationOwner(() => state.dependencies);
    const completion = owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask, transaction: transaction(state.before),
      renderer: state.renderer, rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    });
    expect(state.renderer.commitLayerTransform).not.toHaveBeenCalled();
    finishCapture(state.afterMask);
    await Promise.resolve();
    expect(state.renderer.commitLayerTransform).not.toHaveBeenCalled();
    expect(state.document()).toBe(state.before);
    admitPublication();
    await completion;
    expect(state.pixelsApplied()).toBe(true);
    expect(state.document()).toBe(state.after);
    expect(state.history).toHaveLength(1);
  });

  it('does not turn a committed semantic transform into failure when notification throws', async () => {
    const state = fixture();
    state.dependencies.onLayerTransformCommitted = () => { throw new Error('observer failed'); };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'layer', beforeDocument: state.before, afterDocument: state.after,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: null,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: null
    })).resolves.toBeUndefined();

    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'The transform was committed, but its document change notification failed.'
    );
  });

  it('reserves raster-layer history before committing terminal GPU pixels', async () => {
    const state = fixture();
    const order: string[] = [];
    const reserve = state.dependencies.reserveHistoryEntry;
    state.dependencies.reserveHistoryEntry = (entry) => {
      order.push('reserve');
      return reserve(entry);
    };
    state.renderer.commitLayerTransform = vi.fn(() => {
      order.push('gpu-commit');
      return state.edit;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await owner.apply({
      result: {
        kind: 'raster-layer', beforeDocument: state.before, afterDocument: state.after,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: null,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: null
    });

    expect(order).toEqual(['reserve', 'gpu-commit']);
    expect(state.document()).toBe(state.after);
    expect(state.history).toHaveLength(1);
  });

  it('does not commit raster-layer pixels when history admission is rejected', async () => {
    const state = fixture();
    state.dependencies.reserveHistoryEntry = () => { throw new Error('history unavailable'); };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'raster-layer', beforeDocument: state.before, afterDocument: state.after,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: null,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: null
    })).rejects.toThrow('history unavailable');

    expect(state.renderer.commitLayerTransform).not.toHaveBeenCalled();
    expect(state.renderer.cancelLayerTransform).toHaveBeenCalledOnce();
    expect(state.document()).toBe(state.before);
  });

  it('publishes selected pixels, document, selection and history as one reversible result', async () => {
    const state = fixture();
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    });

    expect(state.document()).toBe(state.after);
    expect(state.currentSelection()).toBe(state.afterSelection);
    expect(state.currentMask()).toBe(state.afterMask);
    expect(state.history).toHaveLength(1);
    expect(state.selectionRevision()).toBe(1);

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
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    });
    state.setRendererGeneration(2);

    await expect(state.history[0].undo()).rejects.toThrow('transform state binding is no longer current');
    expect({ document: state.document(), pixels: state.pixelsApplied() })
      .toEqual({ document: state.after, pixels: true });
  });

  it('rejects a renderer-generation rebind without addressing its replacement', async () => {
    const state = fixture();
    state.renderer.captureTransformSelectionPreview = vi.fn(async () => {
      state.setRendererGeneration(2);
      return state.afterMask;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('publication lease is no longer current');

    expect(state.pixelsApplied()).toBe(false);
    expect(state.renderer.applyPixelHistory).not.toHaveBeenCalled();
    expect(state.destroy).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'The document changed while the transform was finishing; the transform was rolled back.'
    );
  });

  it('rejects a logically newer selection even when object identities are reused', async () => {
    const state = fixture();
    state.renderer.captureTransformSelectionPreview = vi.fn(async () => {
      state.setSelectionRevision(1);
      return state.afterMask;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);
    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('publication lease is no longer current');

    expect(state.pixelsApplied()).toBe(false);
    expect(state.history).toHaveLength(0);
    expect(state.destroy).not.toHaveBeenCalled();
  });

  it('directly rolls back terminal pixels when canonical publication never completed', async () => {
    const state = fixture();
    state.dependencies.applyDocumentAndSelection = async () => {
      throw new Error('selection publication rejected before CAS');
    };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('selection publication rejected before CAS');

    expect(state.pixelsApplied()).toBe(false);
    expect(state.document()).toBe(state.before);
    expect(state.history).toHaveLength(0);
    expect(owner.selectionRollback.blocked).toBe(false);
    expect(owner.unpublishedRollback.blocked).toBe(false);
    expect(state.destroy).not.toHaveBeenCalled();
  });

  it('quarantines an indeterminate publication without guessing which side to restore', async () => {
    const state = fixture();
    state.dependencies.applyDocumentAndSelection = async (_document, _selection, _mask, binding) => {
      binding.publishPixels();
      throw new TransformSelectionPublicationError(
        'publication rollback failed',
        'indeterminate'
      );
    };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('publication rollback failed');

    expect(state.pixelsApplied()).toBe(true);
    expect(state.destroy).not.toHaveBeenCalled();
    await expect(owner.recover()).resolves.toBe(false);
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'Transform publication state is indeterminate; transforms are quarantined until document reload.'
    );
  });

  it('retires an indeterminate edit when the active document session changes', async () => {
    const state = fixture();
    state.dependencies.applyDocumentAndSelection = async (_document, _selection, _mask, binding) => {
      binding.publishPixels();
      throw new TransformSelectionPublicationError('publication rollback failed', 'indeterminate');
    };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('publication rollback failed');

    state.setDocumentSessionId('next-document');
    await expect(owner.recover()).resolves.toBe(true);
    expect(state.destroy).toHaveBeenCalledOnce();
  });

  it('retires an indeterminate edit when its renderer generation is retired', async () => {
    const state = fixture();
    state.dependencies.applyDocumentAndSelection = async (_document, _selection, _mask, binding) => {
      binding.publishPixels();
      throw new TransformSelectionPublicationError('publication rollback failed', 'indeterminate');
    };
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('publication rollback failed');

    state.setRendererGeneration(2);
    owner.retireStaleScope();
    expect(state.destroy).toHaveBeenCalledOnce();
    await expect(owner.recover()).resolves.toBe(true);
  });

  it('quarantines failed compound rollback and retries from a known applied side', async () => {
    const state = fixture();
    let rejectBefore = true;
    const publish = state.dependencies.applyDocumentAndSelection;
    state.dependencies.applyDocumentAndSelection = async (document, nextSelection, mask, binding) => {
      if (document === state.before && rejectBefore) throw new Error('restore before failed');
      await publish(document, nextSelection, mask, binding);
    };
    state.dependencies.reserveHistoryEntry = () => ({
      commit: () => { throw new Error('history failed'); },
      cancel: () => undefined
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
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

  it('reserves history before the terminal GPU write and cancels without mutating pixels', async () => {
    const state = fixture();
    const order: string[] = [];
    state.dependencies.reserveHistoryEntry = () => {
      order.push('reserve');
      throw new Error('history unavailable');
    };
    state.renderer.commitLayerTransform = vi.fn(() => {
      order.push('gpu-commit');
      return state.edit;
    });
    const owner = new TransformPublicationOwner(() => state.dependencies);

    await expect(owner.apply({
      result: {
        kind: 'selection', beforeDocument: state.before, afterDocument: state.after,
        beforeSelection: state.beforeSelection, afterSelection: state.afterSelection,
        layerId: state.before.activeLayerId!
      },
      beforeSelectionMask: state.beforeMask,
      transaction: transaction(state.before),
      renderer: state.renderer,
      rendererGeneration: 1,
      openingSelectionLease: state.selectionLease()
    })).rejects.toThrow('history unavailable');

    expect(order).toEqual(['reserve']);
    expect(state.renderer.cancelLayerTransform).toHaveBeenCalledOnce();
    expect(state.history).toHaveLength(0);
    expect(state.pixelsApplied()).toBe(false);
  });
});
