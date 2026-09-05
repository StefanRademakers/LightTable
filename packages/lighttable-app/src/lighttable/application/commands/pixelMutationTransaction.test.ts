import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  commitAppliedPixelMutation,
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
    expect(fixture.calls).toEqual(['document:After', 'document:Before', 'undo:40', 'undo:20']);
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
});
