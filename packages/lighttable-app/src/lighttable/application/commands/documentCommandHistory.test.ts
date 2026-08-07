import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentCommandHistory } from './documentCommandHistory';

const documentId = 'document-a' as DocumentSessionId;

const command = (
  id: string,
  actions: { undo?: () => void | Promise<void>; redo?: () => void | Promise<void> } = {},
  options: { affectsDocument?: boolean; byteSize?: number; dispose?: () => void } = {}
) => ({
  id,
  type: 'test',
  label: id,
  documentId,
  affectsDocument: options.affectsDocument,
  byteSize: options.byteSize,
  undo: actions.undo ?? (() => undefined),
  redo: actions.redo ?? (() => undefined),
  dispose: options.dispose
});

describe('DocumentCommandHistory', () => {
  it('tracks undo, redo and saved-state dirty identity', async () => {
    const history = new DocumentCommandHistory(documentId);
    const calls: string[] = [];
    history.record(command('paint', {
      undo: () => {
        calls.push('undo');
      },
      redo: () => {
        calls.push('redo');
      }
    }));

    expect(history.getSnapshot()).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true
    });
    history.markSaved();
    expect(history.getSnapshot().dirty).toBe(false);

    await history.undo();
    expect(calls).toEqual(['undo']);
    expect(history.getSnapshot()).toMatchObject({
      canUndo: false,
      canRedo: true,
      dirty: true
    });

    await history.redo();
    expect(calls).toEqual(['undo', 'redo']);
    expect(history.getSnapshot().dirty).toBe(false);
  });

  it('keeps selection-only commands out of document dirty state', async () => {
    const history = new DocumentCommandHistory(documentId);
    history.record(command('selection', {}, { affectsDocument: false }));

    expect(history.getSnapshot()).toMatchObject({
      canUndo: true,
      dirty: false
    });
    await history.undo();
    expect(history.getSnapshot().dirty).toBe(false);
  });

  it('rejects commands aimed at another document', () => {
    const history = new DocumentCommandHistory(documentId);
    expect(() => history.record({
      ...command('foreign'),
      documentId: 'document-b' as DocumentSessionId
    })).toThrow(/targets document-b/);
  });

  it('serializes async undo and refuses overlapping work', async () => {
    let resolveUndo: (() => void) | undefined;
    const history = new DocumentCommandHistory(documentId);
    history.record(command('async', {
      undo: () => new Promise<void>((resolve) => {
        resolveUndo = resolve;
      })
    }));

    const first = history.undo();
    expect(history.getSnapshot().busy).toBe(true);
    expect(await history.undo()).toBe(false);
    resolveUndo?.();
    await first;
    expect(history.getSnapshot().busy).toBe(false);
  });

  it('queues edits recorded during async undo as the new history branch', async () => {
    let resolveUndo: (() => void) | undefined;
    const disposeUndone = vi.fn();
    const history = new DocumentCommandHistory(documentId);
    history.record(command('async', {
      undo: () => new Promise<void>((resolve) => { resolveUndo = resolve; })
    }, { dispose: disposeUndone }));

    const undo = history.undo();
    history.record({
      ...command('replacement'),
      byteSize: 32,
      resourceIds: ['replacement-runtime']
    });

    expect(history.getSnapshot()).toMatchObject({ busy: true, estimatedBytes: 32 });
    expect(history.getRetainedResourceIds().has('replacement-runtime')).toBe(true);
    resolveUndo?.();
    await undo;

    expect(disposeUndone).toHaveBeenCalledOnce();
    expect(history.getSnapshot()).toMatchObject({
      busy: false,
      undoDepth: 1,
      redoDepth: 0,
      canUndo: true,
      canRedo: false
    });
  });

  it('disposes queued commands when history is cleared during an operation', async () => {
    let resolveUndo: (() => void) | undefined;
    const disposePending = vi.fn();
    const history = new DocumentCommandHistory(documentId);
    history.record(command('async', {
      undo: () => new Promise<void>((resolve) => { resolveUndo = resolve; })
    }));
    const undo = history.undo();
    history.record(command('pending', {}, { dispose: disposePending }));

    history.clear();
    expect(disposePending).toHaveBeenCalledOnce();
    resolveUndo?.();
    await undo;
    expect(history.getSnapshot()).toMatchObject({ undoDepth: 0, redoDepth: 0, busy: false });
  });

  it('disposes abandoned redo and budget-evicted resources', async () => {
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const history = new DocumentCommandHistory(documentId, {
      maxEntries: 2,
      maxBytes: 10
    });
    history.record(command('first', {}, { byteSize: 8, dispose: disposeFirst }));
    history.record(command('second', {}, { byteSize: 8, dispose: disposeSecond }));
    expect(disposeFirst).toHaveBeenCalledOnce();

    await history.undo();
    history.record(command('replacement'));
    expect(disposeSecond).toHaveBeenCalledOnce();
  });

  it('exposes resource identities retained by both stacks', async () => {
    const history = new DocumentCommandHistory(documentId);
    history.record({
      ...command('pixels'),
      resourceIds: ['layer-a', 'layer-b']
    });
    await history.undo();
    expect([...history.getRetainedResourceIds()].sort()).toEqual([
      'layer-a',
      'layer-b'
    ]);
  });
});
