import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { DocumentTextPropertyGestureController } from './DocumentTextPropertyGestureController';

describe('DocumentTextPropertyGestureController', () => {
  it('projects multiple inputs once per frame and commits the exact final state once', () => {
    let document = createImageDocument('Text properties', 100, 100, 'transparent');
    let preview: ImageDocument = document;
    const history: Array<{ undo(): void; redo(): void }> = [];
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    const previewSnapshot = vi.fn((next: ImageDocument) => { preview = next; });
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      applySnapshot: (next) => { document = next; preview = next; },
      previewSnapshot,
      discardPreview: () => { preview = document; },
      pushHistoryEntry: (entry) => history.push(entry)
    }));
    const transaction = mutations.begin('text-properties');
    if (!transaction) throw new Error('Transaction unavailable.');
    const controller = new DocumentTextPropertyGestureController(transaction, {
      request: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancel: (frame) => { frames.delete(frame); },
      reportError: (message) => { throw new Error(message); }
    });

    expect(controller.stage((current) => ({ ...current, name: 'A', revision: current.revision + 1 }))).toBe(true);
    expect(controller.stage((current) => ({ ...current, name: 'B', revision: current.revision + 1 }))).toBe(true);
    expect(frames.size).toBe(1);
    for (const callback of [...frames.values()]) callback();
    frames.clear();
    expect(previewSnapshot).toHaveBeenCalledOnce();
    expect(preview.name).toBe('B');

    expect(controller.stage((current) => ({ ...current, name: 'Final', revision: current.revision + 1 }))).toBe(true);
    expect(controller.commit()).toBe(true);
    expect(frames.size).toBe(0);
    expect(document.name).toBe('Final');
    expect(history).toHaveLength(1);
  });

  it('retires a queued A gesture so document B can begin immediately', () => {
    let document = createImageDocument('A', 100, 100, 'transparent');
    let preview = document;
    const history: Array<{ undo(): void; redo(): void }> = [];
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      applySnapshot: (next) => { document = next; preview = next; },
      previewSnapshot: (next) => { preview = next; },
      discardPreview: () => { preview = document; },
      pushHistoryEntry: (entry) => history.push(entry)
    }));
    const scheduler = {
      request: (callback: () => void) => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancel: (frame: number) => { frames.delete(frame); },
      reportError: (message: string) => { throw new Error(message); }
    };
    const firstTransaction = mutations.begin('text-properties');
    if (!firstTransaction) throw new Error('A transaction unavailable.');
    const first = new DocumentTextPropertyGestureController(firstTransaction, scheduler);
    first.stage((current) => ({ ...current, name: 'A preview', revision: current.revision + 1 }));
    expect(frames.size).toBe(1);
    expect(first.cancel()).toBe(true);
    expect(frames.size).toBe(0);

    const secondDocument = createImageDocument('B', 100, 100, 'transparent');
    document = secondDocument;
    preview = secondDocument;
    const secondTransaction = mutations.begin('text-properties');
    if (!secondTransaction) throw new Error('B transaction unavailable.');
    const second = new DocumentTextPropertyGestureController(secondTransaction, scheduler);
    second.stage((current) => ({ ...current, name: 'B final', revision: current.revision + 1 }));
    expect(second.commit()).toBe(true);
    expect(document.name).toBe('B final');
    expect(history).toHaveLength(1);
  });
});
