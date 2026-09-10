import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  commitAppliedPixelMutation,
  reserveAppliedPixelMutation,
  UnpublishedPixelRollbackOwner,
  type PixelMutationHistoryEntry,
  type PixelMutationTransactionDependencies
} from './pixelMutationTransaction';

const createEdit = (byteSize: number): ReversiblePixelEdit => ({
  byteSize,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

const createFixture = () => {
  const before = createImageDocument('Before', 20, 10, 'asset');
  const after = { ...before, revision: before.revision + 1, name: 'After' };
  let document = before;
  const calls: string[] = [];
  const renderer = {
    applyPixelHistory: vi.fn((edit: ReversiblePixelEdit, direction: 'undo' | 'redo') => {
      calls.push(`${direction}:${edit.byteSize}`);
      return direction === 'undo' ? edit.undo() : edit.redo();
    })
  };
  const history: PixelMutationHistoryEntry[] = [];
  const dependencies: PixelMutationTransactionDependencies = {
    getRenderer: () => renderer,
    applyDocumentSnapshot: vi.fn((next) => {
      document = next;
      calls.push(`document:${next.name}`);
    }),
    pushHistoryEntry: (entry) => {
      history.push(entry);
      calls.push('history');
    }
  };
  return { before, after, calls, dependencies, history, renderer, getDocument: () => document };
};

describe('pixelMutationTransaction', () => {
  it('reserves history before an in-place GPU mutation is admitted', () => {
    const fixture = createFixture();
    const dependencies = {
      ...fixture.dependencies,
      reserveHistoryEntry: (entry: PixelMutationHistoryEntry) => {
        fixture.calls.push('reserve');
        let active = true;
        return {
          commit: () => {
            if (!active) return false;
            active = false;
            fixture.history.push(entry);
            fixture.calls.push('history');
            return true;
          },
          cancel: () => { active = false; }
        };
      }
    };
    const reservation = reserveAppliedPixelMutation(() => dependencies, {
      label: 'Mask', type: 'layer.mask.edit', layerIds: [fixture.before.layers[0]!.id]
    });
    expect(fixture.calls).toEqual(['reserve']);
    reservation.commit({
      operation: 'Mask', label: 'Mask', type: 'layer.mask.edit',
      layerIds: [fixture.before.layers[0]!.id], before: fixture.before,
      after: fixture.after, edits: [createEdit(40)]
    });
    expect(fixture.calls).toEqual(['reserve', 'document:After', 'history']);
    expect(fixture.history[0]?.byteSize).toBe(40);
  });

  it('commits document state and replays multiple edits in dependency order', () => {
    const fixture = createFixture();
    const surface = createEdit(20);
    const pixels = createEdit(40);
    commitAppliedPixelMutation(() => fixture.dependencies, {
      operation: 'Brush', label: 'Brush Tool', type: 'paint.stroke',
      layerIds: [fixture.before.layers[0]!.id],
      before: fixture.before, after: fixture.after, edits: [surface, pixels]
    });

    expect(fixture.calls).toEqual(['document:After', 'history']);
    expect(fixture.history[0]?.byteSize).toBe(60);
    fixture.calls.length = 0;
    fixture.history[0]?.undo();
    expect(fixture.calls).toEqual(['undo:40', 'undo:20', 'document:Before']);
    fixture.calls.length = 0;
    fixture.history[0]?.redo();
    expect(fixture.calls).toEqual(['redo:20', 'redo:40', 'document:After']);
  });

  it('restores and destroys already-applied edits when history rejects the commit', () => {
    const fixture = createFixture();
    const surface = createEdit(20);
    const pixels = createEdit(40);
    fixture.dependencies.pushHistoryEntry = () => {
      throw new Error('history rejected');
    };

    expect(() => commitAppliedPixelMutation(() => fixture.dependencies, {
      operation: 'Brush', label: 'Brush Tool', type: 'paint.stroke',
      layerIds: [fixture.before.layers[0]!.id],
      before: fixture.before, after: fixture.after, edits: [surface, pixels]
    })).toThrow('history rejected');

    expect(fixture.getDocument()).toBe(fixture.before);
    expect(fixture.calls).toEqual(['document:After', 'undo:40', 'undo:20', 'document:Before']);
    expect(pixels.destroy).toHaveBeenCalledOnce();
    expect(surface.destroy).toHaveBeenCalledOnce();
  });

  it('restores a required document-owned GPU target before pixel redo', () => {
    const fixture = createFixture();
    const redoBase = { ...fixture.before, name: 'Prepared' };
    const pixels = createEdit(40);
    commitAppliedPixelMutation(() => fixture.dependencies, {
      operation: 'Add mask', label: 'Add Layer Mask', type: 'layer.mask.add',
      layerIds: [fixture.before.layers[0]!.id],
      before: fixture.before, redoBase, after: fixture.after, edits: [pixels]
    });

    fixture.history[0]?.undo();
    fixture.calls.length = 0;
    fixture.history[0]?.redo();

    expect(fixture.calls).toEqual([
      'document:Prepared',
      'redo:40',
      'document:After'
    ]);
    expect(fixture.getDocument()).toBe(fixture.after);
  });

  it('restores a removed document-owned GPU target before pixel undo', () => {
    const fixture = createFixture();
    const undoBase = { ...fixture.before, name: 'Prepared undo' };
    const pixels = createEdit(40);
    commitAppliedPixelMutation(() => fixture.dependencies, {
      operation: 'Delete mask', label: 'Delete Layer Mask', type: 'layer.mask.remove',
      layerIds: [fixture.before.layers[0]!.id],
      before: fixture.before, undoBase, after: fixture.after, edits: [pixels]
    });

    fixture.calls.length = 0;
    fixture.history[0]?.undo();

    expect(fixture.calls).toEqual([
      'document:Prepared undo',
      'undo:40',
      'document:Before'
    ]);
    expect(fixture.getDocument()).toBe(fixture.before);
  });

  it('compensates earlier edits when an undo edit fails', () => {
    const fixture = createFixture();
    const surface = createEdit(20);
    const pixels = createEdit(40);
    commitAppliedPixelMutation(() => fixture.dependencies, {
      operation: 'Brush', label: 'Brush Tool', type: 'paint.stroke',
      layerIds: [fixture.before.layers[0]!.id],
      before: fixture.before, after: fixture.after, edits: [surface, pixels]
    });
    vi.mocked(surface.undo).mockReturnValueOnce(false);
    fixture.calls.length = 0;

    expect(() => fixture.history[0]?.undo()).toThrow('Brush undo is no longer available.');
    expect(fixture.calls).toEqual(['undo:40', 'undo:20', 'redo:40']);
    expect(fixture.getDocument()).toBe(fixture.after);
  });

  it('rolls unpublished edits back in reverse order before destroying them', () => {
    const first = createEdit(20);
    const second = createEdit(40);
    const calls: string[] = [];
    const applied = (edit: ReversiblePixelEdit, direction: 'undo' | 'redo') => {
      calls.push(`${direction}:${edit.byteSize}`);
      return true;
    };

    expect(new UnpublishedPixelRollbackOwner().rollback(applied, [first, second]).ok).toBe(true);
    expect(calls).toEqual(['undo:40', 'undo:20']);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('compensates a partial unpublished rollback and retains recovery snapshots', () => {
    const first = createEdit(20);
    const second = createEdit(40);
    const calls: string[] = [];
    const applied = (edit: ReversiblePixelEdit, direction: 'undo' | 'redo') => {
      calls.push(`${direction}:${edit.byteSize}`);
      return !(direction === 'undo' && edit === first);
    };

    expect(new UnpublishedPixelRollbackOwner().rollback(applied, [first, second]).ok).toBe(false);
    expect(calls).toEqual(['undo:40', 'undo:20', 'redo:40']);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(second.destroy).not.toHaveBeenCalled();
  });

  it('contains thrown rollback failures and retains recovery snapshots', () => {
    const edit = createEdit(20);
    const applied = vi.fn(() => {
      throw new Error('renderer disappeared');
    });

    expect(new UnpublishedPixelRollbackOwner().rollback(applied, [edit]).ok).toBe(false);
    expect(edit.destroy).not.toHaveBeenCalled();
  });

  it('retains a double-failed rollback and retries it through the same owner', () => {
    const first = createEdit(20);
    const second = createEdit(40);
    const owner = new UnpublishedPixelRollbackOwner();
    const state = new Map([[first, true], [second, true]]);
    let failFirstUndo = true;
    let failSecondRedo = true;
    const applied = vi.fn((edit: ReversiblePixelEdit, direction: 'undo' | 'redo') => {
      const isApplied = state.get(edit)!;
      if (direction === 'undo') {
        if (!isApplied) return false;
        if (edit === first && failFirstUndo) {
          failFirstUndo = false;
          return false;
        }
        state.set(edit, false);
        return true;
      }
      if (isApplied) return false;
      if (edit === second && failSecondRedo) {
        failSecondRedo = false;
        return false;
      }
      state.set(edit, true);
      return true;
    });

    expect(owner.rollback(applied, [first, second])).toEqual({
      ok: false, compensationFailed: true
    });
    expect(owner.blocked).toBe(true);
    expect(first.destroy).not.toHaveBeenCalled();
    expect(second.destroy).not.toHaveBeenCalled();
    expect(owner.retry()).toEqual({ ok: true, compensationFailed: false });
    expect(owner.blocked).toBe(false);
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).toHaveBeenCalledOnce();
  });
});
