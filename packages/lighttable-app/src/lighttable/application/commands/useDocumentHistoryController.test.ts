import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createTextLayer } from '../../editor/document/documentCommands';
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
  const pruneLayerRuntimes = vi.fn<(
    documentResourceKey: string,
    rasterIds: ReadonlySet<LayerId>,
    maskIds: ReadonlySet<LayerId>
  ) => void>();
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
    getDocument: () => document,
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
    const [resourceKey, keep] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(resourceKey).toBe(state.getDocument()!.id);
    expect(keep?.has(retained)).toBe(true);
    expect(keep?.size).toBeGreaterThan(1);
  });

  it('separates active node masks from raster runtime retention', () => {
    const state = setup();
    const textDocument = createTextLayer(
      createImageDocument('Text', 32, 24, 'image'),
      createDefaultTextLayerData()
    );
    const textId = textDocument.activeLayerId!;
    state.setDocument({ ...textDocument, layers: [textDocument.layers.at(-1)!] });

    state.controller.pruneResources();

    const [, rasterIds, maskIds] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(rasterIds.has(textId)).toBe(false);
    expect(maskIds.has(textId)).toBe(true);
  });

  it('does not retain a raster runtime for a text-only semantic history entry', () => {
    const state = setup();
    const textDocument = createTextLayer(
      createImageDocument('Text', 32, 24, 'image'),
      createDefaultTextLayerData()
    );
    const textId = textDocument.activeLayerId!;
    state.setDocument({ ...textDocument, layers: [textDocument.layers.at(-1)!] });

    state.controller.record({
      layerIds: [textId],
      resourceIds: [],
      undo: () => undefined,
      redo: () => undefined
    });

    const [, rasterIds, maskIds] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(rasterIds.has(textId)).toBe(false);
    expect(maskIds.has(textId)).toBe(true);
  });

  it('finishes open transactions before undo and user-requested history purge', async () => {
    const state = setup();
    state.controller.record({
      undo: () => undefined,
      redo: () => undefined
    });
    await state.controller.undo();
    const clear = vi.spyOn(state.history, 'clear');
    await state.controller.purge();
    expect(state.finishOpenTransactions).toHaveBeenCalledTimes(2);
    expect(state.finishOpenTransactions.mock.invocationCallOrder[1]).toBeLessThan(
      clear.mock.invocationCallOrder[0]!
    );
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
