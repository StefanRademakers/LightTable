import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type ImageDocument,
  type LayerId
} from '../../editor/document/documentTypes';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentCommandHistory } from './documentCommandHistory';
import {
  createDocumentHistoryController,
  type DocumentHistoryDependencies
} from './useDocumentHistoryController';

const setup = () => {
  const documentId = 'workspace-document' as DocumentSessionId;
  const history = new DocumentCommandHistory(documentId);
  let document: ImageDocument | null = createImageDocument('Image', 32, 24, 'image');
  const pruneLayerRuntimes = vi.fn<(ids: ReadonlySet<LayerId>) => void>();
  const finishOpenTransactions = vi.fn();
  const setError = vi.fn();
  const dependencies: DocumentHistoryDependencies = {
    documentId,
    history,
    getDocument: () => document,
    getRenderer: () => ({ pruneLayerRuntimes }),
    finishOpenTransactions,
    setError
  };
  return {
    controller: createDocumentHistoryController(() => dependencies),
    history,
    pruneLayerRuntimes,
    finishOpenTransactions,
    setError,
    setDocument: (next: ImageDocument | null) => { document = next; }
  };
};

describe('document history controller', () => {
  it('records document-scoped commands with stable defaults', async () => {
    const state = setup();
    const undo = vi.fn();
    const redo = vi.fn();
    state.controller.record({ undo, redo });
    expect(state.history.getSnapshot()).toMatchObject({
      undoDepth: 1,
      dirty: true
    });
    await state.controller.undo();
    expect(undo).toHaveBeenCalledOnce();
    await state.controller.redo();
    expect(redo).toHaveBeenCalledOnce();
  });

  it('retains current and history-owned layer runtimes', () => {
    const state = setup();
    const retained = 'detached-layer' as LayerId;
    state.controller.record({
      layerIds: [retained],
      undo: () => undefined,
      redo: () => undefined
    });
    const keep = state.pruneLayerRuntimes.mock.lastCall?.[0];
    expect(keep?.has(retained)).toBe(true);
    expect(keep?.size).toBeGreaterThan(1);
  });

  it('finishes open transactions before undo and clear', async () => {
    const state = setup();
    state.controller.record({
      undo: () => undefined,
      redo: () => undefined
    });
    await state.controller.undo();
    state.controller.clear();
    expect(state.finishOpenTransactions).toHaveBeenCalledTimes(2);
  });

  it('publishes undo errors without rejecting the editor event loop', async () => {
    const state = setup();
    state.controller.record({
      undo: () => { throw new Error('GPU snapshot expired.'); },
      redo: () => undefined
    });
    await expect(state.controller.undo()).resolves.toBe(false);
    expect(state.setError).toHaveBeenCalledWith('GPU snapshot expired.');
  });
});
