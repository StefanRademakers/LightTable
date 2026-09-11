import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createTextLayer } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type DocumentAssetId,
  type ImageDocument,
  type LayerId
} from '../../editor/document/documentTypes';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentCommandHistory } from './documentCommandHistory';
import {
  createDocumentHistoryController,
  type DocumentHistoryDependencies
} from './useDocumentHistoryController';

const setup = (
  historyOptions: ConstructorParameters<typeof DocumentCommandHistory>[1] = {}
) => {
  const documentId = 'workspace-document' as DocumentSessionId;
  const history = new DocumentCommandHistory(documentId, historyOptions);
  let document: ImageDocument | null = createImageDocument('Image', 32, 24, 'image');
  const pruneLayerRuntimes = vi.fn<(
    rasterIds: ReadonlySet<LayerId>,
    maskIds: ReadonlySet<LayerId>,
    colorLookupIds: ReadonlySet<DocumentAssetId>
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

  it('does not expose a reserved command until its owner commits it', () => {
    const state = setup();
    const reservation = state.controller.reserve({
      label: 'Rasterize Layer',
      type: 'layer.rasterize',
      undo: () => undefined,
      redo: () => undefined,
    });

    expect(state.history.getSnapshot()).toMatchObject({ undoDepth: 0, busy: true });
    expect(reservation.commit()).toBe(true);
    expect(state.history.getSnapshot()).toMatchObject({ undoDepth: 1, busy: false });
    expect(reservation.commit()).toBe(false);
  });

  it('accounts for a deferred reservation byte size at commit time', () => {
    const state = setup({ maxBytes: 64 });
    const first = {
      label: 'Deferred GPU edit',
      byteSize: 0,
      undo: () => undefined,
      redo: () => undefined,
    };
    const reservation = state.controller.reserve(first);
    first.byteSize = 48;
    expect(reservation.commit()).toBe(true);
    expect(state.history.getSnapshot()).toMatchObject({
      undoDepth: 1,
      estimatedBytes: 48,
    });

    state.controller.record({
      label: 'Second GPU edit',
      byteSize: 48,
      undo: () => undefined,
      redo: () => undefined,
    });
    expect(state.history.getSnapshot()).toMatchObject({
      undoDepth: 1,
      estimatedBytes: 48,
    });
  });

  it('cancels a reserved command without changing history', () => {
    const state = setup();
    const reservation = state.controller.reserve({
      undo: () => undefined,
      redo: () => undefined,
    });

    reservation.cancel();
    reservation.cancel();
    expect(state.history.getSnapshot()).toMatchObject({ undoDepth: 0, busy: false });
  });

  it('retains current and history-owned layer runtimes', () => {
    const state = setup();
    const retained = 'detached-layer' as LayerId;
    state.controller.record({
      layerIds: [retained],
      undo: () => undefined,
      redo: () => undefined
    });
    const [keep] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(keep?.has(retained)).toBe(true);
    expect(keep?.size).toBeGreaterThan(1);
  });

  it('stops retaining an evicted history runtime at the next prune boundary', () => {
    const state = setup({ maxEntries: 1 });
    const evicted = 'evicted-runtime' as LayerId;
    const retained = 'retained-runtime' as LayerId;
    state.controller.record({
      layerIds: [evicted],
      undo: () => undefined,
      redo: () => undefined
    });
    state.controller.record({
      layerIds: [retained],
      undo: () => undefined,
      redo: () => undefined
    });

    const [keepRaster, keepMasks] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(keepRaster.has(evicted)).toBe(false);
    expect(keepMasks.has(evicted)).toBe(false);
    expect(keepRaster.has(retained)).toBe(true);
    expect(keepMasks.has(retained)).toBe(true);
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

    const [rasterIds, maskIds] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(rasterIds.has(textId)).toBe(false);
    expect(maskIds.has(textId)).toBe(true);
  });

  it('retains document and history-owned color lookup resources', () => {
    const state = setup();
    const active = 'active-lut' as DocumentAssetId;
    const retained = 'undo-lut' as DocumentAssetId;
    state.setDocument({
      ...state.getDocument()!,
      assets: {
        ...state.getDocument()!.assets,
        colorLookups: [{
          id: active,
          name: 'Active LUT',
          size: 2,
          domainMin: [0, 0, 0],
          domainMax: [1, 1, 1],
          byteLength: 1,
          revision: 0
        }]
      }
    });
    state.controller.record({
      resourceIds: [retained],
      undo: () => undefined,
      redo: () => undefined
    });

    const [, , colorLookupIds] = state.pruneLayerRuntimes.mock.lastCall!;
    expect(colorLookupIds).toEqual(new Set([active, retained]));
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

    const [rasterIds, maskIds] = state.pruneLayerRuntimes.mock.lastCall!;
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

  it('does not restore history until an asynchronous document publication settles', async () => {
    const state = setup();
    let finishPublication: () => void = () => undefined;
    state.finishOpenTransactions.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishPublication = resolve;
    }));
    const undo = vi.fn();
    state.controller.record({ undo, redo: () => undefined });

    const restoring = state.controller.undo();
    await Promise.resolve();
    expect(undo).not.toHaveBeenCalled();
    finishPublication();
    await restoring;
    expect(undo).toHaveBeenCalledOnce();
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
