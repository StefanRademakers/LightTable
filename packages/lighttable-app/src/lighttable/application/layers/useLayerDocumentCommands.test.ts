import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createSubpath, createVectorPath } from '@lighttable/vector-core';
import { addLayerMask, createRasterLayer, createTextLayer, setLayerLocked } from '../../editor/document/documentCommands';
import {
  createAdjustmentLayer as createAdjustmentLayerNode,
  createGroupLayer as createGroupLayerNode,
  createImageDocument,
  createTextLayerNode,
  createVectorLayer,
  type ImageDocument,
  type LayerNode
} from '../../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  createFeatherSelectionOperation,
  createFullCanvasSelection
} from '../../editor/selection/selectionTypes';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type GradientMapAdjustments
} from '../../types';
import {
  createLayerDocumentCommands,
  type LayerCommandHistoryEntry,
  type LayerCommandRendererPort,
  type LayerDocumentCommandDependencies
} from './useLayerDocumentCommands';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { LightTableSelectionReadLease } from '../tools/selection/DocumentSelectionStateStore';
import { findDocumentLayer } from '../../editor/document/layerTree';

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

const renderer = (edit: ReversiblePixelEdit = pixelEdit()): LayerCommandRendererPort => ({
  duplicateLayerPixels: vi.fn(() => true),
  copyLayerMask: vi.fn(() => true),
  beginLayerPixelEdit: vi.fn(),
  captureAllPixelEdit: vi.fn(() => 1),
  mergeLayers: vi.fn(() => true),
  flattenGroup: vi.fn(() => true),
  flattenImage: vi.fn(() => true),
  prepareRasterDestination: vi.fn(() => true),
  loadLayerAssets: vi.fn(async () => undefined),
  commitRasterDestination: vi.fn(),
  releaseRasterDestination: vi.fn(() => true),
  rasterizeLayer: vi.fn(() => true),
  invertLayerColors: vi.fn(() => true),
  bakeSelectionIntoLayerMask: vi.fn(() => true),
  applyGeneratedLayerMask: vi.fn(() => true),
  applyLayerMaskToPixels: vi.fn(() => true),
  copySelectedLayerContent: vi.fn(() => true),
  exportSelectionClipboard: vi.fn(async () => new Blob(['selection'], { type: 'image/png' })),
  exportMergedSelection: vi.fn(async () => new Blob(['merged'], { type: 'image/png' })),
  pasteClipboardImage: vi.fn(async () => true),
  pasteSelectionClipboard: vi.fn(() => true),
  hasSelectionClipboard: vi.fn(() => true),
  finishPixelEdit: vi.fn(() => edit),
  cancelPixelEdit: vi.fn(),
  applyPixelHistory: vi.fn((entry, direction) => (
    direction === 'undo' ? entry.undo() : entry.redo()
  ))
});

const setup = (initialDocument: ImageDocument) => {
  let document = initialDocument;
  let documentId = 'test-document';
  let rendererGeneration = 1;
  let previewDocument: ImageDocument | null = null;
  const activeRenderer = renderer();
  const historyEntries: LayerCommandHistoryEntry[] = [];
  const imageClipboard = {
    writeImage: vi.fn(async () => undefined),
    readImage: vi.fn(async () => ({
      blob: new Blob(['clipboard'], { type: 'image/png' }),
      placement: null as {
        sourceDocumentId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      } | null
    }))
  };
  let documentAdjustments = createDefaultAdjustments();
  let panelAdjustments = createDefaultAdjustments();
  let globalGradeStrength = 100;
  let documentMutations!: LayerDocumentCommandDependencies['documentMutations'];
  const dependencies: LayerDocumentCommandDependencies = {
    getDocument: () => document,
    getRenderer: () => activeRenderer,
    getRendererGeneration: () => rendererGeneration,
    getImageClipboard: () => imageClipboard,
    getDocumentId: () => documentId,
    get documentMutations() {
      return documentMutations;
    },
    applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
      document = next;
    }),
    pushDocumentHistory: vi.fn(),
    pushHistoryEntry: vi.fn((entry: LayerCommandHistoryEntry) => historyEntries.push(entry)),
    setActiveChannel: vi.fn(),
    setSelectionClipboardAvailable: vi.fn(),
    setStatus: vi.fn(),
    setError: vi.fn(),
    getDocumentAdjustments: () => documentAdjustments,
    getPanelAdjustments: () => panelAdjustments,
    publishDocumentAdjustments: vi.fn((next) => {
      documentAdjustments = cloneAdjustments(next);
    }),
    publishPanelAdjustments: vi.fn((next) => {
      panelAdjustments = cloneAdjustments(next);
    }),
    getGlobalGradeStrength: () => globalGradeStrength,
    publishGlobalGradeStrength: vi.fn((next) => {
      globalGradeStrength = next;
    })
  };
  documentMutations = createDocumentMutationController(() => ({
    getDocument: dependencies.getDocument,
    applySnapshot: dependencies.applyDocumentSnapshot,
    previewSnapshot: (next) => {
      previewDocument = next;
    },
    discardPreview: () => {
      previewDocument = null;
    },
    pushHistoryEntry: dependencies.pushHistoryEntry
  }));
  const commands = createLayerDocumentCommands(() => dependencies);
  return {
    commands,
    dependencies,
    renderer: activeRenderer,
    imageClipboard,
    historyEntries,
    document: () => document,
    setDocumentMutations: (next: LayerDocumentCommandDependencies['documentMutations']) => {
      documentMutations = next;
    },
    setDocumentId: (next: string) => {
      documentId = next;
    },
    setRendererGeneration: (next: number) => {
      rendererGeneration = next;
    },
    previewDocument: () => previewDocument,
    documentAdjustments: () => documentAdjustments,
    panelAdjustments: () => panelAdjustments,
    globalGradeStrength: () => globalGradeStrength
  };
};

describe('useLayerDocumentCommands', () => {
  it('places a decoded image atomically as one tight editable layer', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 12, height: 8, close })));
    const state = setup(createImageDocument('Place', 100, 80, 'asset'));
    const result = await state.commands.placeImageArtifact(
      new File(['image'], 'badge.png', { type: 'image/png' }), { x: -4, y: 9 }
    );
    expect(result).toEqual(expect.objectContaining({ width: 12, height: 8 }));
    const layer = state.document().layers.at(-1);
    expect(layer).toMatchObject({ name: 'badge', width: 12, height: 8,
      transform: { tx: -4, ty: 9 } });
    expect(state.renderer.loadLayerAssets).toHaveBeenCalledWith([{
      layerId: layer?.id, pixels: expect.any(File), mask: null
    }]);
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('publishes no document or history transition when placed image decode fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 12, height: 8, close: vi.fn() })));
    const state = setup(createImageDocument('Place failure', 100, 80, 'asset'));
    vi.mocked(state.renderer.loadLayerAssets).mockRejectedValue(new Error('decode failed'));
    const before = state.document();
    expect(await state.commands.placeImageArtifact(
      new File(['bad'], 'bad.webp', { type: 'image/webp' })
    )).toBeNull();
    expect(state.document()).toBe(before);
    expect(state.historyEntries).toHaveLength(0);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('adds an all-white layer mask without running a selection copy', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const layerId = state.document().activeLayerId!;

    expect(state.commands.addActiveLayerMask(false)).toBe(true);

    expect(state.document().layers[0]?.mask).not.toBeNull();
    expect(state.renderer.bakeSelectionIntoLayerMask).not.toHaveBeenCalled();
    expect(state.historyEntries).toHaveLength(1);
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('mask');
    expect(state.document().activeLayerId).toBe(layerId);
  });

  it('adds a mask to an explicit background target without changing presentation state', () => {
    const bottom = createImageDocument('Test', 32, 24, 'asset');
    const bottomId = bottom.activeLayerId!;
    const state = setup(createRasterLayer(bottom, 'Top'));
    const activeId = state.document().activeLayerId!;

    expect(state.commands.addLayerMask(bottomId, false)).toBe(true);

    expect(state.document().layers.find(({ id }) => id === bottomId)?.mask).not.toBeNull();
    expect(state.document().activeLayerId).toBe(activeId);
    expect(state.dependencies.setActiveChannel).not.toHaveBeenCalled();
    expect(state.dependencies.setStatus).not.toHaveBeenCalled();
    expect(state.dependencies.setError).not.toHaveBeenCalled();
  });

  it('bakes the current raster selection into a new mask as one pixel-history step', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const layerId = state.document().activeLayerId!;

    expect(state.commands.addActiveLayerMask(true)).toBe(true);

    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(layerId, 'mask');
    expect(state.renderer.bakeSelectionIntoLayerMask).toHaveBeenCalledWith(layerId);
    expect(state.document().layers[0]?.mask?.pixelRevision).toBe(1);
    expect(state.historyEntries).toHaveLength(1);
    state.historyEntries[0].undo();
    expect(state.document().layers[0]?.mask).toBeNull();
    state.historyEntries[0].redo();
    expect(state.document().layers[0]?.mask?.pixelRevision).toBe(1);
  });

  it('rolls the mask pixels and document node back when history rejects the command', () => {
    const initial = createImageDocument('Mask history failure', 32, 24, 'asset');
    const state = setup(initial);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.addActiveLayerMask(true)).toBe(false);

    expect(state.document()).toBe(initial);
    expect(state.renderer.applyPixelHistory).toHaveBeenCalledWith(expect.anything(), 'undo');
    expect(state.historyEntries).toHaveLength(0);
  });

  it('deletes and restores exact mask pixels through one history entry', () => {
    const source = createImageDocument('Delete mask', 32, 24, 'asset');
    const layerId = source.activeLayerId!;
    const state = setup(addLayerMask(source, layerId));

    expect(state.commands.removeLayerMask(layerId)).toBe(true);
    expect(state.document().layers[0]?.mask).toBeNull();
    expect(state.renderer.captureAllPixelEdit).toHaveBeenCalledWith(layerId, 'mask');
    expect(state.historyEntries).toHaveLength(1);

    state.historyEntries[0]!.undo();
    expect(state.document().layers[0]?.mask).not.toBeNull();
    expect(state.renderer.applyPixelHistory).toHaveBeenLastCalledWith(expect.anything(), 'undo');
    state.historyEntries[0]!.redo();
    expect(state.document().layers[0]?.mask).toBeNull();
    expect(state.renderer.applyPixelHistory).toHaveBeenLastCalledWith(expect.anything(), 'redo');
  });

  it('keeps the mask and destroys its unpublished edit when delete history rejects', () => {
    const source = createImageDocument('Delete mask failure', 32, 24, 'asset');
    const layerId = source.activeLayerId!;
    const state = setup(addLayerMask(source, layerId));
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.removeLayerMask(layerId)).toBe(false);

    expect(state.document().layers[0]?.mask).not.toBeNull();
    expect(state.renderer.applyPixelHistory).toHaveBeenCalledWith(expect.anything(), 'undo');
    expect(state.historyEntries).toHaveLength(0);
  });

  it('applies a raster mask without baking unrelated live layer semantics', () => {
    const source = createImageDocument('Apply mask', 32, 24, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const layer = masked.layers[0]!;
    const liveStyle = layer.styleStack;
    const pixelHistory = pixelEdit();
    const maskHistory = pixelEdit();
    const state = setup(masked);
    vi.mocked(state.renderer.finishPixelEdit)
      .mockReturnValueOnce(pixelHistory)
      .mockReturnValueOnce(maskHistory);

    expect(state.commands.applyLayerMask(layerId)).toBe(true);

    const result = state.document().layers[0]!;
    expect(result.id).toBe(layerId);
    expect(result.mask).toBeNull();
    expect(result.styleStack).toBe(liveStyle);
    expect(state.renderer.applyLayerMaskToPixels).toHaveBeenCalledWith(masked, layerId);
    expect(vi.mocked(state.renderer.beginLayerPixelEdit).mock.calls).toEqual([
      [layerId, 'pixels'], [layerId, 'mask']
    ]);
    expect(state.historyEntries[0]).toMatchObject({ type: 'layer.mask.apply', layerIds: [layerId] });

    state.historyEntries[0]!.undo();
    expect(state.document().layers[0]?.mask).not.toBeNull();
    expect(vi.mocked(state.renderer.applyPixelHistory).mock.calls.slice(-2)).toEqual([
      [maskHistory, 'undo'], [pixelHistory, 'undo']
    ]);
    state.historyEntries[0]!.redo();
    expect(state.document().layers[0]?.mask).toBeNull();
    expect(vi.mocked(state.renderer.applyPixelHistory).mock.calls.slice(-2)).toEqual([
      [pixelHistory, 'redo'], [maskHistory, 'redo']
    ]);
  });

  it('restores both pixels and mask when Apply Mask history rejects', () => {
    const source = createImageDocument('Apply mask failure', 32, 24, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const state = setup(masked);
    vi.mocked(state.renderer.finishPixelEdit)
      .mockReturnValueOnce(pixelEdit())
      .mockReturnValueOnce(pixelEdit());
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.applyLayerMask(layerId)).toBe(false);
    expect(state.document()).toBe(masked);
    expect(vi.mocked(state.renderer.applyPixelHistory).mock.calls.map(([, direction]) => direction))
      .toEqual(['undo', 'undo']);
    expect(state.historyEntries).toHaveLength(0);
  });

  it('retains rollback ownership when Apply Mask publication is refused before admission', () => {
    const source = createImageDocument('Apply mask refusal', 32, 24, 'asset');
    const layerId = source.activeLayerId!;
    const masked = addLayerMask(source, layerId);
    const pixelHistory = pixelEdit();
    const maskHistory = pixelEdit();
    const state = setup(masked);
    vi.mocked(state.renderer.finishPixelEdit)
      .mockReturnValueOnce(pixelHistory)
      .mockReturnValueOnce(maskHistory);
    const cancel = vi.fn(() => true);
    state.setDocumentMutations({
      begin: vi.fn(() => ({
        documentId: masked.id,
        owner: 'layer.mask.apply',
        before: masked,
        current: masked,
        active: true,
        stage: vi.fn(() => true),
        change: vi.fn(() => false),
        commit: vi.fn(() => false),
        commitWith: vi.fn(() => false),
        commitWithAsync: vi.fn(async () => false),
        cancel
      }))
    });

    expect(state.commands.applyLayerMask(layerId)).toBe(false);
    expect(pixelHistory.undo).toHaveBeenCalledOnce();
    expect(maskHistory.undo).toHaveBeenCalledOnce();
    expect(pixelHistory.destroy).toHaveBeenCalledOnce();
    expect(maskHistory.destroy).toHaveBeenCalledOnce();
    expect(state.historyEntries).toHaveLength(0);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('applies a generated background matte as one editable mask transaction', () => {
    const state = setup(createImageDocument('Remove background', 32, 24, 'asset'));
    const layerId = state.document().activeLayerId!;
    const mask = { width: 32, height: 24, data: new Uint8Array(32 * 24).fill(192) };

    expect(state.commands.applyBackgroundRemovalMask(layerId, mask, 'replace')).toBe(true);

    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(layerId, 'mask');
    expect(state.renderer.applyGeneratedLayerMask).toHaveBeenCalledWith(layerId, mask, 'replace');
    expect(state.document().layers[0]?.mask?.pixelRevision).toBe(1);
    expect(state.historyEntries).toHaveLength(1);
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('mask');
    state.historyEntries[0]!.undo();
    expect(state.document().layers[0]?.mask).toBeNull();
    state.historyEntries[0]!.redo();
    expect(state.document().layers[0]?.mask?.pixelRevision).toBe(1);
  });

  it('can intersect an existing mask or create a separate masked layer', () => {
    const intersect = setup(createImageDocument('Intersect', 8, 8, 'asset'));
    const intersectLayerId = intersect.document().activeLayerId!;
    intersect.commands.addActiveLayerMask(false);
    const mask = { width: 8, height: 8, data: new Uint8Array(64).fill(255) };
    expect(intersect.commands.applyBackgroundRemovalMask(intersectLayerId, mask, 'intersect')).toBe(true);
    expect(intersect.renderer.applyGeneratedLayerMask).toHaveBeenLastCalledWith(
      intersect.document().activeLayerId, mask, 'intersect'
    );

    const duplicate = setup(createImageDocument('Duplicate', 8, 8, 'asset'));
    const originalId = duplicate.document().activeLayerId!;
    expect(duplicate.commands.applyBackgroundRemovalMask(originalId, mask, 'new-layer')).toBe(true);
    expect(duplicate.document().layers).toHaveLength(2);
    expect(duplicate.document().activeLayerId).not.toBe(originalId);
    expect(duplicate.renderer.duplicateLayerPixels).toHaveBeenCalledWith(
      originalId, duplicate.document().activeLayerId
    );
    expect(duplicate.historyEntries[0]?.byteSize).toBe(64 + (8 * 8 * 10));
  });

  it('rolls a new background-removal layer back when history rejects it', () => {
    const source = createImageDocument('Remove background failure', 8, 8, 'asset');
    const state = setup(source);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });
    expect(state.commands.applyBackgroundRemovalMask(source.activeLayerId!, {
      width: 8, height: 8, data: new Uint8Array(64).fill(255)
    }, 'new-layer')).toBe(false);
    expect(state.document()).toBe(source);
    expect(state.renderer.applyPixelHistory).toHaveBeenCalledWith(expect.anything(), 'undo');
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.historyEntries).toHaveLength(0);
  });

  it('does not publish a partial mask command when the GPU upload fails', () => {
    const state = setup(createImageDocument('Failure', 8, 8, 'asset'));
    const layerId = state.document().activeLayerId!;
    vi.mocked(state.renderer.applyGeneratedLayerMask).mockReturnValue(false);

    expect(state.commands.applyBackgroundRemovalMask(layerId, {
      width: 8, height: 8, data: new Uint8Array(64)
    }, 'replace')).toBe(false);

    expect(state.document().layers[0]?.mask).toBeNull();
    expect(state.historyEntries).toHaveLength(0);
    expect(state.renderer.cancelPixelEdit).toHaveBeenCalledOnce();
  });

  it('rejects malformed generated mask storage before opening a GPU edit', () => {
    const state = setup(createImageDocument('Malformed mask', 8, 8, 'asset'));
    const layerId = state.document().activeLayerId!;

    expect(state.commands.applyBackgroundRemovalMask(layerId, {
      width: 8, height: 8, data: new Uint8Array(12)
    }, 'replace')).toBe(false);

    expect(state.renderer.beginLayerPixelEdit).not.toHaveBeenCalled();
    expect(state.historyEntries).toHaveLength(0);
    expect(state.document().layers[0]?.mask).toBeNull();
  });

  it('copies selected layer pixels to the system image clipboard', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const selection = createFullCanvasSelection(32, 24);

    await expect(state.commands.copySelectedContent(selection)).resolves.toMatchObject({
      file: expect.any(File), bounds: { x: 0, y: 0, width: 32, height: 24 }
    });

    expect(state.renderer.copySelectedLayerContent).toHaveBeenCalledOnce();
    expect(state.renderer.exportSelectionClipboard).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 32,
      height: 24
    });
    expect(state.imageClipboard.writeImage).toHaveBeenCalledOnce();
  });

  it('keeps async copy metadata owned by its source document', async () => {
    let finishExport!: (blob: Blob) => void;
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    vi.mocked(state.renderer.exportSelectionClipboard).mockReturnValue(new Promise((resolve) => {
      finishExport = resolve;
    }));

    const copying = state.commands.copySelectedContent(createFullCanvasSelection(32, 24));
    state.setDocumentId('other-document');
    finishExport(new Blob(['selection'], { type: 'image/png' }));
    const copied = await copying;

    expect(state.imageClipboard.writeImage).toHaveBeenCalledWith(expect.any(Blob),
      expect.objectContaining({ sourceDocumentId: 'test-document' }));
    expect(copied?.fastPasteToken).toBeUndefined();
  });

  it('retains feather support in clipboard export and placement bounds', async () => {
    const state = setup(createImageDocument('Test', 100, 80, 'asset'));
    const selection = [{
      mode: 'replace' as const,
      shape: {
        kind: 'rectangle' as const,
        points: [{ x: 20, y: 15 }, { x: 60, y: 45 }]
      }
    }, createFeatherSelectionOperation(100, 80, 12.4)];

    await expect(state.commands.copySelectedContent(selection)).resolves.toMatchObject({
      file: expect.any(File), bounds: { x: 0, y: 0, width: 86, height: 71 }
    });

    const support = { x: 0, y: 0, width: 86, height: 71 };
    expect(state.renderer.exportSelectionClipboard).toHaveBeenCalledWith(support);
    expect(state.imageClipboard.writeImage).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining(support)
    );
  });

  it('uses the committed mask lease bounds instead of semantic operation bounds', async () => {
    const state = setup(createImageDocument('Test', 100, 80, 'asset'));
    let revision = 4;
    state.dependencies.getSelectionLease = () => ({
      document: { sessionId: 'test-document', revision: 0 },
      selection: {
        documentSessionId: 'test-document',
        revision,
        canvas: { width: 100, height: 80 },
        active: true,
        coverage: SelectionMaskSnapshot.fromRaw(100, 80, new Uint16Array(8_000)),
        supportBounds: { x: 25, y: 20, width: 18, height: 12 },
        provenance: createFullCanvasSelection(100, 80),
      },
    } as unknown as LightTableSelectionReadLease);

    await expect(state.commands.copySelectedContent(
      createFullCanvasSelection(100, 80),
    )).resolves.toMatchObject({
      bounds: { x: 25, y: 20, width: 18, height: 12 },
    });
    expect(state.renderer.exportSelectionClipboard).toHaveBeenCalledWith({
      x: 25, y: 20, width: 18, height: 12,
    });

    let finishExport!: (blob: Blob) => void;
    vi.mocked(state.renderer.exportSelectionClipboard).mockReturnValueOnce(
      new Promise((resolve) => { finishExport = resolve; }),
    );
    const staleCopy = state.commands.copySelectedContent(createFullCanvasSelection(100, 80));
    revision += 1;
    finishExport(new Blob(['selection'], { type: 'image/png' }));
    await expect(staleCopy).resolves.toBeNull();
  });

  it('copies the visible composited result for Copy Merged', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    await expect(
      state.commands.copyMergedContent(createFullCanvasSelection(32, 24))
    ).resolves.toMatchObject({
      file: expect.any(File), bounds: { x: 0, y: 0, width: 32, height: 24 }
    });

    expect(state.renderer.exportMergedSelection).toHaveBeenCalledOnce();
    expect(state.renderer.copySelectedLayerContent).not.toHaveBeenCalled();
    expect(state.imageClipboard.writeImage).toHaveBeenCalledOnce();
  });

  it('pastes the current active-layer artifact through the renderer fast clipboard', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const copied = await state.commands.copySelectedContent(createFullCanvasSelection(16, 12));
    expect(copied?.fastPasteToken).toBeTruthy();

    await expect(state.commands.pastePixelArtifact(
      copied!.file, { x: 0, y: 0, width: 16, height: 12, name: 'Pasted Selection' },
      copied!.fastPasteToken
    )).resolves.toMatchObject({ width: 16, height: 12 });

    expect(state.renderer.pasteSelectionClipboard).toHaveBeenCalledOnce();
    expect(state.renderer.pasteClipboardImage).not.toHaveBeenCalled();
    expect(state.document().layers).toHaveLength(2);
    expect(state.document().layers.at(-1)).toMatchObject({ width: 32, height: 24 });
    expect(state.historyEntries).toHaveLength(1);
  });

  it('falls back to the bounded image artifact when a fast token is stale', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const copied = await state.commands.copySelectedContent(createFullCanvasSelection(16, 12));

    await expect(state.commands.pastePixelArtifact(
      copied!.file, { x: 3, y: 4, width: 16, height: 12 }, 'stale-token'
    )).resolves.toMatchObject({ width: 16, height: 12 });

    expect(state.renderer.pasteSelectionClipboard).not.toHaveBeenCalled();
    expect(state.renderer.pasteClipboardImage).not.toHaveBeenCalled();
    expect(state.renderer.loadLayerAssets).toHaveBeenCalledWith([{
      layerId: state.document().activeLayerId, pixels: copied!.file, mask: null
    }]);
    expect(state.document().layers.at(-1)).toMatchObject({
      width: 16, height: 12,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 3, ty: 4 }
    });
  });

  it('does not let the Paste in Place fast path override normal centered placement', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const copied = await state.commands.copySelectedContent(createFullCanvasSelection(16, 12));

    await state.commands.pastePixelArtifact(
      copied!.file,
      { x: 8, y: 6, width: 16, height: 12, target: { channel: 'pixels' } },
      copied!.fastPasteToken
    );

    expect(state.renderer.pasteSelectionClipboard).not.toHaveBeenCalled();
    expect(state.renderer.pasteClipboardImage).not.toHaveBeenCalled();
    expect(state.document().layers.at(-1)).toMatchObject({
      width: 16, height: 12,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 8, ty: 6 }
    });
  });

  it('pastes into the selected mask without creating a new layer and records GPU undo', async () => {
    const initial = createImageDocument('Test', 32, 24, 'asset');
    const layerId = initial.activeLayerId!;
    const state = setup(addLayerMask(initial, layerId));

    const result = await state.commands.pastePixelArtifact(
      new File(['mask'], 'mask.png', { type: 'image/png' }),
      { x: 5, y: 7, width: 10, height: 6,
        target: { channel: 'mask', layerId } }
    );

    expect(result).toMatchObject({ layerId, width: 10, height: 6 });
    expect(state.document().layers).toHaveLength(1);
    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(layerId, 'mask');
    expect(state.renderer.captureAllPixelEdit).toHaveBeenCalledWith(layerId, 'mask');
    expect(state.renderer.pasteClipboardImage).toHaveBeenCalledWith(
      layerId, expect.any(File), { x: 5, y: 7 }, 'mask'
    );
    const committedLayer = state.document().layers[0];
    expect(committedLayer?.mask?.pixelRevision).toBe(1);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledOnce();
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('mask');
  });

  it('retains an oversized external clipboard image outside the canvas', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 48, height: 36, close: vi.fn()
    })));
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    await expect(state.commands.pasteSelectedContent([])).resolves.toBe(true);

    expect(state.renderer.pasteClipboardImage).not.toHaveBeenCalled();
    expect(state.renderer.pasteSelectionClipboard).not.toHaveBeenCalled();
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(
      expect.objectContaining({ width: 48, height: 36 })
    );
    expect(state.renderer.loadLayerAssets).toHaveBeenCalledWith([{
      layerId: state.document().activeLayerId, pixels: expect.any(File), mask: null
    }]);
    expect(state.document().layers).toHaveLength(2);
    expect(state.document().layers.at(-1)).toMatchObject({
      width: 48, height: 36,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: -8, ty: -6 }
    });
    expect(state.renderer.commitRasterDestination).toHaveBeenCalledWith(
      state.document().activeLayerId
    );
    vi.unstubAllGlobals();
  });

  it('cancels an async clipboard paste when the target document changes', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    let finishRead!: (image: Awaited<ReturnType<typeof state.imageClipboard.readImage>>) => void;
    state.imageClipboard.readImage.mockReturnValue(new Promise((resolve) => {
      finishRead = resolve;
    }));

    const pasting = state.commands.pasteSelectedContent([]);
    state.setDocumentId('other-document');
    finishRead({ blob: new Blob(['clipboard'], { type: 'image/png' }), placement: null });

    await expect(pasting).resolves.toBe(false);
    expect(state.document().layers).toHaveLength(1);
    expect(state.renderer.loadLayerAssets).not.toHaveBeenCalled();
  });

  it('centers an external clipboard image at the active selection without scaling it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 10, height: 6, close: vi.fn()
    })));
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const selection = createFullCanvasSelection(16, 12);

    await expect(state.commands.pasteSelectedContent(selection)).resolves.toBe(true);

    expect(state.renderer.pasteClipboardImage).not.toHaveBeenCalled();
    expect(state.document().layers.at(-1)).toMatchObject({
      width: 10, height: 6,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 3, ty: 3 }
    });
    vi.unstubAllGlobals();
  });

  it('duplicates the active layer pixels and records one document command', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const sourceId = state.document().activeLayerId;

    expect(state.commands.duplicateActiveLayer()).toBe(true);

    expect(state.document().layers).toHaveLength(2);
    expect(state.renderer.duplicateLayerPixels).toHaveBeenCalledWith(
      sourceId,
      state.document().activeLayerId
    );
    expect(state.historyEntries).toHaveLength(1);
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('pixels');
  });

  it('keeps the source document intact when raster duplication fails', () => {
    const initial = createImageDocument('Duplicate failure', 32, 24, 'asset');
    const state = setup(initial);
    vi.mocked(state.renderer.duplicateLayerPixels).mockReturnValue(false);

    expect(state.commands.duplicateActiveLayer()).toBe(false);

    expect(state.document()).toBe(initial);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.historyEntries).toHaveLength(0);
  });

  it('duplicates canonical text without requesting nonexistent raster pixels', () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));

    expect(state.commands.duplicateActiveLayer()).toBe(true);

    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.renderer.duplicateLayerPixels).not.toHaveBeenCalled();
    expect(state.historyEntries).toHaveLength(1);
  });

  it('duplicates canonical vector shapes without requesting raster preview pixels', () => {
    const document = createImageDocument('Vector', 32, 24, 'asset');
    const vector = createVectorLayer([
      createVectorPath('path', 'PSD path', [createSubpath('contour')])
    ], 'PSD Shape');
    document.layers = [vector];
    document.activeLayerId = vector.id;
    const state = setup(document);

    expect(state.commands.duplicateActiveLayer()).toBe(true);
    expect(state.document().layers.at(-1)?.type).toBe('vector');
    expect(state.renderer.duplicateLayerPixels).not.toHaveBeenCalled();
    expect(state.historyEntries).toHaveLength(1);
  });

  it('duplicates an Adjustment Layer and retains its mask through GPU history', () => {
    const state = setup(createImageDocument('Adjustment duplicate', 32, 24, 'asset'));
    expect(state.commands.createAdjustmentLayer()).toBe(true);
    const sourceId = state.document().activeLayerId!;
    state.historyEntries.splice(0);

    expect(state.commands.duplicateActiveLayer()).toBe(true);

    const destinationId = state.document().activeLayerId!;
    const duplicate = findDocumentLayer(state.document(), destinationId);
    expect(duplicate).toMatchObject({ type: 'adjustment', name: 'Grade copy' });
    expect(duplicate?.mask?.id).not.toBe(findDocumentLayer(state.document(), sourceId)?.mask?.id);
    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(destinationId, 'mask');
    expect(state.renderer.captureAllPixelEdit).toHaveBeenCalledWith(destinationId, 'mask');
    expect(state.renderer.copyLayerMask).toHaveBeenCalledWith(sourceId, destinationId);
    expect(state.historyEntries).toHaveLength(1);

    state.historyEntries[0]!.undo();
    expect(findDocumentLayer(state.document(), destinationId)).toBeNull();
    state.historyEntries[0]!.redo();
    expect(findDocumentLayer(state.document(), destinationId)?.type).toBe('adjustment');
    expect(vi.mocked(state.renderer.applyPixelHistory).mock.calls.map(([, direction]) => direction))
      .toEqual(['undo', 'redo']);
  });

  it('rasterizes text through the same fresh-destination transaction as every semantic layer', async () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    const layerId = state.document().activeLayerId!;

    await expect(state.commands.rasterizeTextLayerWhenReady(layerId)).resolves.toBe(true);

    const destination = state.document().layers.at(-1)!;
    expect(destination).toMatchObject({ type: 'raster' });
    expect(destination.id).not.toBe(layerId);
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(destination);
    expect(state.renderer.rasterizeLayer).toHaveBeenCalledWith(
      expect.anything(), layerId, destination.id
    );
    expect(state.historyEntries).toHaveLength(1);

    for (let cycle = 0; cycle < 20; cycle += 1) {
      state.historyEntries[0].undo();
      expect(state.document().layers.at(-1)).toMatchObject({ id: layerId, type: 'text' });
      state.historyEntries[0].redo();
      expect(state.document().layers.at(-1)).toMatchObject({ id: destination.id, type: 'raster' });
    }
  });

  it('rasterizes a semantic vector layer through one reversible full-canvas destination', async () => {
    const document = createImageDocument('Vector rasterize', 32, 24, 'asset');
    const vector = createVectorLayer([
      createVectorPath('rasterize-path', 'Shape', [createSubpath('contour')])
    ], 'Shape');
    document.layers = [vector];
    document.activeLayerId = vector.id;
    const state = setup(document);

    await expect(state.commands.rasterizeActiveLayer()).resolves.toBe(true);

    const destination = state.document().layers[0]!;
    expect(destination).toMatchObject({ type: 'raster', name: 'Shape', width: 32, height: 24 });
    expect(destination.id).not.toBe(vector.id);
    expect(state.renderer.rasterizeLayer).toHaveBeenCalledWith(
      document, vector.id, destination.id
    );
    expect(state.historyEntries).toHaveLength(1);
    state.historyEntries[0]!.undo();
    expect(state.document().layers[0]).toMatchObject({ id: vector.id, type: 'vector' });
    state.historyEntries[0]!.redo();
    expect(state.document().layers[0]).toMatchObject({ id: destination.id, type: 'raster' });
  });

  it('retains every nested runtime when rasterizing a group', async () => {
    const document = createImageDocument('Group rasterize', 32, 24, 'unused');
    const child = createImageDocument('Child', 32, 24, 'child-asset').layers[0]!;
    child.derivedPreview = {
      width: 4,
      height: 3,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      dependencyKey: 'test-preview',
      source: 'imported-semantic-preview'
    };
    const group = createGroupLayerNode('Artwork');
    group.children = [child];
    document.layers = [group];
    document.activeLayerId = group.id;
    const state = setup(document);

    await expect(state.commands.rasterizeLayerWhenReady(group.id)).resolves.toBe(true);

    const destination = state.document().layers[0]!;
    expect(state.historyEntries[0]?.layerIds).toEqual([group.id, child.id, destination.id]);
    expect(state.historyEntries[0]?.byteSize).toBe((32 * 24 * 8 * 2) + (4 * 3 * 8));
    state.historyEntries[0]!.undo();
    expect(findDocumentLayer(state.document(), child.id)).toBe(child);
  });

  it('releases an unpublished raster and restores the semantic layer when history rejects rasterize', () => {
    const document = createImageDocument('Vector rollback', 32, 24, 'asset');
    const vector = createVectorLayer([], 'Shape');
    document.layers = [vector];
    document.activeLayerId = vector.id;
    const state = setup(document);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.rasterizeLayer(vector.id)).toBe(false);

    expect(state.document()).toBe(document);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('waits for a newly published text source before an automated rasterization', async () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Fresh text'
    ));
    const layerId = state.document().activeLayerId!;
    const waitForTextSource = vi.fn(async () => true);
    state.renderer.waitForTextSource = waitForTextSource;

    await expect(state.commands.rasterizeTextLayerWhenReady(layerId)).resolves.toBe(true);

    expect(waitForTextSource).toHaveBeenCalledWith(layerId);
    expect(state.renderer.rasterizeLayer).toHaveBeenCalledOnce();
    expect(state.document().layers.at(-1)).toMatchObject({ type: 'raster' });
    expect(state.document().layers.at(-1)?.id).not.toBe(layerId);
    expect(state.historyEntries).toHaveLength(1);
  });

  it('waits for hidden intrinsic text before forcing it visible for rasterization', async () => {
    const document = createTextLayer(
      createImageDocument('Hidden text', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Hidden text'
    );
    const layer = findDocumentLayer(document, document.activeLayerId)!;
    layer.visible = false;
    layer.opacity = 0;
    const state = setup(document);
    const waitForTextSource = vi.fn(async () => true);
    state.renderer.waitForTextSource = waitForTextSource;

    await expect(state.commands.rasterizeLayerWhenReady(layer.id)).resolves.toBe(true);

    expect(waitForTextSource).toHaveBeenCalledWith(layer.id);
    expect(state.renderer.rasterizeLayer).toHaveBeenCalledOnce();
  });

  it('waits for contributing text inside a hidden group before flattening the group', async () => {
    const document = createImageDocument('Hidden group', 32, 24, 'asset');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Nested text');
    const group = createGroupLayerNode('Hidden group');
    group.visible = false;
    group.opacity = 0;
    group.children = [text];
    document.layers = [group];
    document.activeLayerId = group.id;
    const state = setup(document);
    const waitForTextSource = vi.fn(async () => true);
    state.renderer.waitForTextSource = waitForTextSource;

    await expect(state.commands.flattenWhenReady({ kind: 'group', groupId: group.id }))
      .resolves.toBe(true);

    expect(waitForTextSource).toHaveBeenCalledWith(text.id);
    expect(state.renderer.flattenGroup).toHaveBeenCalledOnce();
  });

  it('rejects rasterization when the document changes while text is being prepared', async () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Fresh text'
    ));
    const layerId = state.document().activeLayerId!;
    state.renderer.waitForTextSource = vi.fn(async () => {
      const current = state.document();
      state.dependencies.applyDocumentSnapshot({ ...current, revision: current.revision + 1 });
      return true;
    });

    await expect(state.commands.rasterizeTextLayerWhenReady(layerId)).rejects.toThrow(
      'The document changed while its text source was being prepared.'
    );

    expect(state.renderer.rasterizeLayer).not.toHaveBeenCalled();
    expect(state.historyEntries).toEqual([]);
  });

  it('rolls back a failed GPU text rasterization without document history', async () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    vi.mocked(state.renderer.rasterizeLayer).mockReturnValue(false);
    const layerId = state.document().activeLayerId!;

    await expect(state.commands.rasterizeTextLayerWhenReady(layerId)).rejects.toThrow(
      'The prepared layer could not be rasterized.'
    );

    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.historyEntries).toEqual([]);
  });

  it('releases the fresh text destination and restores the source when history publication throws', async () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    const layerId = state.document().activeLayerId!;
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    await expect(state.commands.rasterizeTextLayerWhenReady(layerId)).rejects.toThrow(
      'The prepared layer could not be rasterized.'
    );

    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
    expect(state.document().layers.at(-1)).toMatchObject({ id: layerId, type: 'text' });
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('creates a Grade layer as one reversible document transaction', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    state.panelAdjustments().exposureEV = 1.25;

    expect(state.commands.createAdjustmentLayer()).toBe(true);

    const grade = state.document().layers.at(-1);
    expect(grade?.type).toBe('adjustment');
    expect(grade?.mask).toMatchObject({
      enabled: true,
      linked: true,
      density: 1,
      feather: 0,
      pixelRevision: 0
    });
    // A new Grade Layer is an explicit, neutral owner. The command changes
    // only canonical document state; the contextual panel is derived by the
    // editor projection adapter and is not part of command history.
    expect(state.panelAdjustments().exposureEV).toBe(1.25);
    expect(state.documentAdjustments().exposureEV).toBe(0);
    if (grade?.type !== 'adjustment') throw new Error('Expected a Grade layer.');
    expect(grade.adjustmentStack.modules.every((module) => module.revision === 0)).toBe(true);
    expect(state.historyEntries).toHaveLength(1);

    state.historyEntries[0].undo();
    expect(state.document().layers).toHaveLength(1);

    state.historyEntries[0].redo();
    expect(state.document().layers.at(-1)?.type).toBe('adjustment');
    expect(state.dependencies.publishPanelAdjustments).not.toHaveBeenCalled();
  });

  it('creates a Lens Fx layer with only Lens Fx modules above the active layer', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const backgroundId = state.document().activeLayerId;

    expect(state.commands.createLensFxLayer()).toBe(true);

    const layer = state.document().layers.at(-1);
    expect(layer?.type).toBe('adjustment');
    expect(layer?.name).toBe('Lens Fx');
    if (layer?.type !== 'adjustment') throw new Error('Expected a Lens Fx layer.');
    expect(layer.adjustmentStack.modules.some((module) =>
      module.type === 'lt.lens-distortion'
    )).toBe(true);
    expect(layer.adjustmentStack.modules.some((module) =>
      module.type === 'lt.light'
    )).toBe(false);
    expect(state.document().layers[0]?.id).toBe(backgroundId);
    expect(state.historyEntries).toHaveLength(1);
  });

  it('creates a Lens Fx layer beside the active layer inside its group', () => {
    const document = createImageDocument('Test', 32, 24, 'asset');
    const background = document.layers[0]!;
    const group = createGroupLayerNode('Group');
    group.children = [background];
    document.layers = [group];
    document.activeLayerId = background.id;
    const state = setup(document);

    expect(state.commands.createLensFxLayer()).toBe(true);

    expect(state.document().layers).toHaveLength(1);
    const updatedGroup = state.document().layers[0];
    expect(updatedGroup).toMatchObject({ type: 'group' });
    if (updatedGroup?.type !== 'group') throw new Error('Expected group fixture.');
    expect(updatedGroup.children).toHaveLength(2);
    expect(updatedGroup.children[0]).toMatchObject({ id: background.id });
    expect(updatedGroup.children[1]).toMatchObject({
      type: 'adjustment', name: 'Lens Fx', adjustmentKind: 'lens-fx'
    });
  });

  it('creates a standalone Curves node with exactly one processing module', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    expect(state.commands.createCurvesAdjustmentLayer()).toBe(true);

    const layer = state.document().layers.at(-1);
    expect(layer?.type).toBe('adjustment');
    expect(layer?.name).toBe('Curves');
    if (layer?.type !== 'adjustment') throw new Error('Expected a Curves adjustment layer.');
    expect(layer.adjustmentKind).toBe('curves');
    expect(layer.adjustmentStack.modules.map((module) => module.type)).toEqual(['lt.curves']);
    expect(layer.adjustmentStack.modules[0]?.settings).toMatchObject({
      curves: { interpolation: 'photoshop-natural' }
    });
    expect(layer.mask).not.toBeNull();
  });

  it('creates Gaussian Blur as a masked full-frame filter layer', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    expect(state.commands.createAdjustmentLayerOfKind(
      'gaussian-blur', undefined, { radius: 14.5 }
    )).toBe(true);

    const layer = state.document().layers.at(-1);
    if (layer?.type !== 'adjustment') throw new Error('Expected a Gaussian Blur layer.');
    expect(layer).toMatchObject({
      name: 'Gaussian Blur',
      adjustmentKind: 'gaussian-blur',
      mask: expect.any(Object)
    });
    expect(layer.adjustmentStack.modules).toEqual([
      expect.objectContaining({
        type: 'lt.gaussian-blur',
        enabled: true,
        settings: { radius: 14.5 }
      })
    ]);
    expect(state.dependencies.publishDocumentAdjustments).not.toHaveBeenCalled();
    expect(state.dependencies.publishPanelAdjustments).not.toHaveBeenCalled();
    expect(state.historyEntries).toHaveLength(1);
    const rasterId = state.document().layers[0]!.id;
    const adjustmentId = state.commands.createAttachedAdjustment(
      rasterId, 'gaussian-blur', { radius: 8 }
    );
    expect(adjustmentId).toEqual(expect.any(String));
    const raster = state.document().layers.find(({ id }) => id === rasterId);
    expect(raster?.type === 'raster' ? raster.attachedAdjustments : null).toEqual([
      expect.objectContaining({
        id: adjustmentId,
        adjustmentKind: 'gaussian-blur',
        name: 'Gaussian Blur',
        enabled: true,
        adjustmentStack: expect.objectContaining({
          modules: [expect.objectContaining({
            type: 'lt.gaussian-blur', settings: { radius: 8 }
          })]
        })
      })
    ]);
  });

  it('rejects missing Displace maps for standalone and attached creation', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const rasterId = state.document().layers[0]!.id;
    const settings = { mapAssetId: 'missing-raster' };
    expect(state.commands.createAdjustmentLayerOfKind('displace', undefined, settings)).toBe(false);
    expect(state.commands.createAttachedAdjustment(rasterId, 'displace', settings)).toBeNull();
    expect(state.historyEntries).toHaveLength(0);
    expect(state.document().layers).toHaveLength(1);

    expect(state.commands.createAdjustmentLayerOfKind(
      'displace', undefined, { mapAssetId: rasterId }
    )).toBe(true);
  });

  it.each([
    ['high-pass', 'High Pass', { radius: 18 }],
    ['unsharp-mask', 'Unsharp Mask', { amount: 140, radius: 2, threshold: 4 }],
    ['motion-blur', 'Motion Blur', { angle: 25, distance: 48 }],
    ['smart-sharpen', 'Smart Sharpen', {
      amount: 150, radius: 2, reduceNoise: 25, remove: 'lens', angle: 0
    }],
    ['reduce-noise', 'Reduce Noise', {
      strength: 6, preserveDetails: 60, reduceColorNoise: 45, sharpenDetails: 25
    }],
    ['maximum', 'Maximum', { radius: 12, shape: 'round' }],
    ['minimum', 'Minimum', { radius: 6, shape: 'square' }],
    ['offset', 'Offset', { horizontal: 18, vertical: -9, edgeMode: 'wrap' }]
  ] as const)('creates global and attached %s filters from one canonical model', (
    kind, name, settings
  ) => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    expect(state.commands.createAdjustmentLayerOfKind(kind, undefined, settings)).toBe(true);
    const filter = state.document().layers.at(-1);
    if (filter?.type !== 'adjustment') throw new Error(`Expected ${name}.`);
    expect(filter).toMatchObject({ name, adjustmentKind: kind, mask: expect.any(Object) });
    expect(filter.adjustmentStack.modules[0]).toMatchObject({
      type: `lt.${kind}`, settings
    });

    const rasterId = state.document().layers[0]!.id;
    const adjustmentId = state.commands.createAttachedAdjustment(rasterId, kind, settings);
    const raster = state.document().layers.find(({ id }) => id === rasterId);
    expect(raster?.type === 'raster' ? raster.attachedAdjustments : []).toContainEqual(
      expect.objectContaining({ id: adjustmentId, adjustmentKind: kind, name })
    );
  });

  it.each([
    ['exposure', 'Exposure', 'lt.photoshop-adjustment'],
    ['vibrance', 'Vibrance', 'lt.photoshop-adjustment'],
    ['gradient-map', 'Gradient Map', 'lt.gradient-map']
  ] as const)('creates a focused %s adjustment node', (kind, name, moduleType) => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    expect(state.commands.createAdjustmentLayerOfKind(kind)).toBe(true);

    const layer = state.document().layers.at(-1);
    expect(layer?.type).toBe('adjustment');
    expect(layer?.name).toBe(name);
    if (layer?.type !== 'adjustment') throw new Error(`Expected a ${name} adjustment layer.`);
    expect(layer.adjustmentKind).toBe(kind);
    expect(layer.adjustmentStack.modules.map((module) => module.type)).toEqual([moduleType]);
    if (kind === 'gradient-map') {
      expect(layer.adjustmentStack.modules[0]?.settings.gradientMap)
        .toMatchObject({ enabled: true });
    }
    expect(layer.mask).not.toBeNull();
  });

  it.each([
    'brightness-contrast', 'levels', 'exposure', 'hue-saturation',
    'color-balance', 'black-white', 'photo-filter', 'channel-mixer',
    'color-lookup', 'selective-color', 'invert', 'posterize', 'threshold'
  ] as const)('creates %s as an independent Photoshop adjustment node', (kind) => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    expect(state.commands.createAdjustmentLayerOfKind(kind)).toBe(true);
    const layer = state.document().layers.at(-1);
    if (layer?.type !== 'adjustment') throw new Error('Expected an adjustment layer.');
    expect(layer.adjustmentKind).toBe(kind);
    expect(layer.adjustmentStack.modules).toHaveLength(1);
    expect(layer.adjustmentStack.modules[0]?.type).toBe('lt.photoshop-adjustment');
    expect(layer.adjustmentStack.modules[0]?.settings.photoshopAdjustment)
      .toMatchObject({ kind });
    expect(layer.mask).not.toBeNull();
  });

  it('creates an adjustment layer above an explicit stable anchor', () => {
    const document = createRasterLayer(
      createRasterLayer(createImageDocument('Test', 32, 24, 'asset'), 'Bottom'),
      'Top'
    );
    const state = setup(document);
    const bottomId = state.document().layers.find(({ name }) => name === 'Bottom')!.id;

    expect(state.commands.createAdjustmentLayerOfKind('curves', bottomId)).toBe(true);

    expect(state.document().layers.map(({ name }) => name))
      .toEqual(['Background', 'Bottom', 'Curves', 'Top']);
    expect(state.document().activeLayerId).toBe(state.document().layers[2]!.id);
  });

  it('creates Posterize and Threshold directly with their requested initial settings', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const rasterId = state.document().layers[0]!.id;
    expect(state.commands.createAdjustmentLayerOfKind(
      'posterize', undefined, { posterizeLevels: 6 }
    )).toBe(true);
    const posterize = state.document().layers.at(-1);
    if (posterize?.type !== 'adjustment') throw new Error('Expected Posterize layer.');
    expect(posterize.adjustmentStack.modules[0]?.settings.photoshopAdjustment)
      .toMatchObject({ kind: 'posterize', posterizeLevels: 6 });

    const thresholdId = state.commands.createAttachedAdjustment(
      rasterId, 'threshold', { thresholdLevel: 160 }
    );
    expect(thresholdId).toMatch(/^attached-/);
    const raster = state.document().layers.find(({ id }) => id === rasterId);
    if (raster?.type !== 'raster') throw new Error('Expected raster layer.');
    expect(raster.attachedAdjustments?.[0]?.adjustmentStack.modules[0]
      ?.settings.photoshopAdjustment).toMatchObject({
      kind: 'threshold', thresholdLevel: 160
    });
  });

  it('creates a Gradient Map with its authored gradient in the same history step', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    expect(state.commands.createAdjustmentLayerOfKind('gradient-map', undefined, {
      colorStops: [
        { position: 0, midpoint: 0.5, color: { r: 0.04, g: 0.02, b: 0.16 } },
        { position: 1, midpoint: 0.5, color: { r: 1, g: 0.72, b: 0.12 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 1 },
        { position: 1, midpoint: 0.5, opacity: 0.8 }
      ],
      dither: true,
      interpolation: 'perceptual'
    })).toBe(true);
    const layer = state.document().layers.at(-1);
    if (layer?.type !== 'adjustment') throw new Error('Expected Gradient Map layer.');
    const gradientMap = layer.adjustmentStack.modules[0]?.settings.gradientMap as
      | GradientMapAdjustments
      | undefined;
    expect(gradientMap).toMatchObject({
      enabled: true,
      dither: true,
      interpolation: 'perceptual'
    });
    expect(gradientMap?.colorStops).toHaveLength(2);
    expect(gradientMap?.colorStops[0]?.color).toEqual({ r: 0.04, g: 0.02, b: 0.16 });
    expect(gradientMap?.opacityStops.map(({ opacity }) => opacity)).toEqual([1, 0.8]);
    expect(state.dependencies.pushHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it('applies an authored Gradient Map when attached directly to a raster layer', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const rasterId = state.document().layers[0]!.id;
    expect(state.commands.createAttachedAdjustment(rasterId, 'gradient-map', {
      colorStops: [
        { position: 0, midpoint: 0.4, color: { r: 0.1, g: 0.2, b: 0.3 } },
        { position: 1, midpoint: 0.6, color: { r: 0.9, g: 0.8, b: 0.7 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 0.75 },
        { position: 1, midpoint: 0.5, opacity: 1 }
      ],
      reverse: true,
      interpolation: 'smooth'
    })).toMatch(/^attached-/);
    const raster = state.document().layers[0];
    if (raster?.type !== 'raster') throw new Error('Expected raster layer.');
    const gradientMap = raster.attachedAdjustments?.[0]?.adjustmentStack.modules[0]
      ?.settings.gradientMap as GradientMapAdjustments | undefined;
    expect(gradientMap).toMatchObject({ enabled: true, reverse: true, interpolation: 'smooth' });
    expect(gradientMap?.colorStops[0]?.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    expect(gradientMap?.opacityStops[0]?.opacity).toBe(0.75);
    expect(state.historyEntries).toHaveLength(1);
  });

  it('attaches independent adjustment nodes without replacing the raster local grade', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const raster = state.document().layers[0]!;

    const exposureId = state.commands.createAttachedAdjustment(raster.id, 'exposure');
    const thresholdId = state.commands.createAttachedAdjustment(raster.id, 'threshold');

    expect(exposureId).toMatch(/^attached-/);
    expect(thresholdId).toMatch(/^attached-/);
    expect(state.document().layers).toHaveLength(1);
    const current = state.document().layers[0];
    if (current?.type !== 'raster') throw new Error('Expected the raster layer.');
    expect(current.adjustmentStack).toBeNull();
    expect(current.attachedAdjustments?.map(({ adjustmentKind }) => adjustmentKind))
      .toEqual(['exposure', 'threshold']);
    expect(current.attachedAdjustments?.map(({ adjustmentStack }) =>
      (adjustmentStack.modules[0]?.settings.photoshopAdjustment as { kind?: string } | undefined)?.kind))
      .toEqual(['exposure', 'threshold']);
    expect(state.historyEntries).toHaveLength(2);
  });

  it('merges contiguous tight raster layers into a reversible full-canvas destination', () => {
    const first = createImageDocument('Test', 32, 24, 'asset');
    const state = setup(createRasterLayer(first, 'Top'));
    const layerIds = state.document().layers.map((layer) => layer.id);

    expect(state.commands.mergeSelectedLayers(layerIds)).toBe(true);

    expect(state.document().layers).toHaveLength(1);
    const mergedId = state.document().layers[0]!.id;
    expect(mergedId).not.toBe(layerIds[0]);
    expect(state.document().layers[0]).toMatchObject({ width: 32, height: 24 });
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(
      expect.objectContaining({ id: mergedId, width: 32, height: 24 })
    );
    expect(state.historyEntries).toHaveLength(1);
    state.historyEntries[0].undo();
    expect(state.document().layers).toHaveLength(2);
    expect(state.renderer.applyPixelHistory).not.toHaveBeenCalled();
    state.historyEntries[0].redo();
    expect(state.document().layers[0]?.id).toBe(mergedId);
  });

  it('retains nested source runtimes and accounts for them when merging a group', () => {
    const document = createImageDocument('Group merge', 32, 24, 'unused');
    const child = createImageDocument('Child', 32, 24, 'child-asset').layers[0]!;
    const group = createGroupLayerNode('Artwork');
    group.children = [child];
    const top = createImageDocument('Top', 32, 24, 'top-asset').layers[0]!;
    document.layers = [group, top];
    document.activeLayerId = top.id;
    const state = setup(document);

    expect(state.commands.mergeSelectedLayers([top.id, group.id])).toBe(true);

    const destination = state.document().layers[0]!;
    expect(state.historyEntries[0]?.layerIds).toEqual([
      group.id, child.id, top.id, destination.id
    ]);
    expect(state.historyEntries[0]?.byteSize).toBe(32 * 24 * 8 * 3);
    state.historyEntries[0]!.undo();
    expect(findDocumentLayer(state.document(), group.id)).toBe(group);
    expect(findDocumentLayer(state.document(), child.id)).toBe(child);
  });

  it('restores every source layer and releases the destination when merge history rejects', () => {
    const document = createRasterLayer(createImageDocument('Merge rollback', 32, 24, 'asset'), 'Top');
    const state = setup(document);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.mergeSelectedLayers(document.layers.map(({ id }) => id))).toBe(false);

    expect(state.document()).toBe(document);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('merges the active raster layer down and reports the completed command', () => {
    const first = createImageDocument('Test', 32, 24, 'asset');
    const state = setup(createRasterLayer(first, 'Top'));

    expect(state.commands.mergeActiveLayerDown()).toBe(true);

    expect(state.document().layers).toHaveLength(1);
    expect(state.dependencies.setStatus).toHaveBeenCalledWith('Layers merged');
    expect(state.historyEntries).toHaveLength(1);
  });

  it('flattens into a new full-canvas runtime and restores source runtimes on undo', () => {
    const first = createImageDocument('Test', 32, 24, 'asset');
    const state = setup(createRasterLayer(first, 'Top'));
    const sourceIds = state.document().layers.map(({ id }) => id);
    state.documentAdjustments().exposureEV = 1.25;
    state.documentAdjustments().effects.grain.enabled = true;
    state.documentAdjustments().effects.grain.amount = 35;
    state.panelAdjustments().exposureEV = 1.25;
    state.dependencies.publishGlobalGradeStrength!(42);

    expect(state.commands.flatten({ kind: 'image' })).toBe(true);

    const destination = state.document().layers[0];
    expect(destination).toMatchObject({ type: 'raster', width: 32, height: 24 });
    expect(sourceIds).not.toContain(destination?.id);
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(destination);
    expect(state.renderer.flattenImage).toHaveBeenCalledWith(
      expect.anything(), destination?.id
    );
    expect(state.historyEntries).toHaveLength(1);
    expect(state.documentAdjustments()).toEqual(createDefaultAdjustments());
    expect(state.panelAdjustments()).toEqual(createDefaultAdjustments());
    expect(state.globalGradeStrength()).toBe(100);
    state.historyEntries[0].undo();
    expect(state.document().layers.map(({ id }) => id)).toEqual(sourceIds);
    expect(state.documentAdjustments().exposureEV).toBe(1.25);
    expect(state.documentAdjustments().effects.grain).toMatchObject({ enabled: true, amount: 35 });
    expect(state.panelAdjustments().exposureEV).toBe(1.25);
    expect(state.globalGradeStrength()).toBe(42);
    state.historyEntries[0].redo();
    expect(state.document().layers[0]?.id).toBe(destination?.id);
    expect(state.documentAdjustments()).toEqual(createDefaultAdjustments());
    expect(state.globalGradeStrength()).toBe(100);
  });

  it('flattens a group without baking its outer stack relationship and restores it repeatedly', () => {
    const document = createImageDocument('Group flatten', 32, 24, 'unused');
    const child = createImageDocument('Child', 32, 24, 'child-asset').layers[0]!;
    const group = createGroupLayerNode('Artwork');
    group.children = [child];
    group.opacity = 0.45;
    group.blendMode = 'multiply';
    group.clipping = true;
    document.layers = [group];
    document.activeLayerId = group.id;
    const state = setup(document);

    expect(state.commands.flatten({ kind: 'group', groupId: group.id })).toBe(true);

    const destination = state.document().layers[0]!;
    expect(destination).toMatchObject({
      type: 'raster', name: 'Artwork', opacity: 0.45,
      blendMode: 'multiply', clipping: true
    });
    expect(state.renderer.flattenGroup).toHaveBeenCalledWith(document, group.id, destination.id);
    expect(state.historyEntries[0]?.layerIds).toEqual([group.id, child.id, destination.id]);
    for (let cycle = 0; cycle < 20; cycle += 1) {
      state.historyEntries[0]!.undo();
      expect(state.document().layers[0]).toMatchObject({ id: group.id, type: 'group' });
      state.historyEntries[0]!.redo();
      expect(state.document().layers[0]).toMatchObject({ id: destination.id, type: 'raster' });
    }
  });

  it('restores the complete group and releases its destination when flatten history rejects', () => {
    const document = createImageDocument('Group rollback', 32, 24, 'unused');
    const child = createImageDocument('Child', 32, 24, 'child-asset').layers[0]!;
    const group = createGroupLayerNode('Artwork');
    group.children = [child];
    document.layers = [group];
    document.activeLayerId = group.id;
    const state = setup(document);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.flatten({ kind: 'group', groupId: group.id })).toBe(false);

    expect(state.document()).toBe(document);
    expect(state.document().layers[0]).toBe(group);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('restores layers and document processing when flatten history rejects', () => {
    const document = createRasterLayer(createImageDocument('Flatten rollback', 32, 24, 'asset'), 'Top');
    const state = setup(document);
    state.documentAdjustments().exposureEV = 1.25;
    state.panelAdjustments().exposureEV = 0.75;
    state.dependencies.publishGlobalGradeStrength!(42);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.flatten({ kind: 'image' })).toBe(false);

    expect(state.document()).toBe(document);
    expect(state.documentAdjustments().exposureEV).toBe(1.25);
    expect(state.panelAdjustments().exposureEV).toBe(0.75);
    expect(state.globalGradeStrength()).toBe(42);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('bakes an active vector shape into the raster layer below with pixel history', () => {
    const document = createImageDocument('Vector merge', 32, 24, 'asset');
    const vector = createVectorLayer([
      createVectorPath('shape', 'Shape', [createSubpath('contour')])
    ], 'Shape');
    document.layers.push(vector);
    document.activeLayerId = vector.id;
    const state = setup(document);
    const sourceDestinationId = document.layers[0]!.id;

    expect(state.commands.mergeActiveLayerDown()).toBe(true);

    expect(state.renderer.mergeLayers).toHaveBeenCalledWith(
      expect.anything(), [sourceDestinationId, vector.id], state.document().layers[0]!.id
    );
    expect(state.document().layers).toHaveLength(1);
    expect(state.document().layers[0]).toMatchObject({
      type: 'raster', name: 'Shape', blendMode: 'normal', width: 32, height: 24
    });
    expect(state.document().layers[0]?.id).not.toBe(sourceDestinationId);
    expect(state.historyEntries).toHaveLength(1);
  });

  it('rejects deferred vector rasterization after renderer replacement', () => {
    const before = createImageDocument('Vector raster handoff', 32, 24, 'asset');
    const vector = createVectorLayer([
      createVectorPath('shape', 'Shape', [createSubpath('contour')])
    ], 'Shape');
    const preview = {
      ...before,
      layers: [...before.layers, vector],
      activeLayerId: vector.id
    };
    const state = setup(before);
    state.setRendererGeneration(2);

    expect(state.commands.rasterizeVectorCreation({
      beforeDocument: before,
      previewDocument: preview,
      layerId: vector.id,
      elementId: 'shape',
      commitWith: vi.fn(() => false)
    }, 1)).toBe(false);

    expect(state.renderer.mergeLayers).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenLastCalledWith(
      'The shape preview is no longer the active document state.'
    );
  });

  it('merges selected raster pixels above a vector shape into a fresh raster', () => {
    const document = createImageDocument('Vector-first merge', 32, 24, 'asset');
    const vector = createVectorLayer([
      createVectorPath('shape', 'Shape', [createSubpath('contour')])
    ], 'Shape');
    document.layers.push(vector);
    const withRaster = createRasterLayer(document, 'Pixels', vector.id);
    const shape = withRaster.layers[1]!;
    const pixels = withRaster.layers[2]!;
    const state = setup(withRaster);

    expect(state.commands.mergeSelectedLayers([pixels.id, shape.id])).toBe(true);

    const merged = state.document().layers[1]!;
    expect(state.renderer.mergeLayers).toHaveBeenCalledWith(
      expect.anything(), [shape.id, pixels.id], merged.id
    );
    expect(merged).toMatchObject({ type: 'raster', name: 'Pixels', width: 32, height: 24 });
    expect(state.historyEntries).toHaveLength(1);
  });

  it('executes every ordered semantic layer pair without a type-specific merge error', () => {
    type Kind = 'raster' | 'vector' | 'text' | 'adjustment' | 'group';
    const kinds: readonly Kind[] = ['raster', 'vector', 'text', 'adjustment', 'group'];
    const node = (kind: Kind, name: string): LayerNode => {
      if (kind === 'raster') {
        const layer = createImageDocument(name, 32, 24, `asset-${crypto.randomUUID()}`).layers[0]!;
        return { ...layer, name };
      }
      if (kind === 'vector') return { ...createVectorLayer([], name), name };
      if (kind === 'text') return createTextLayerNode(createDefaultTextLayerData(), name);
      if (kind === 'adjustment') return createAdjustmentLayerNode(
        createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()), name
      );
      const group = createGroupLayerNode(name);
      group.children = [node('raster', `${name} content`)];
      return group;
    };

    for (const bottomKind of kinds) {
      for (const topKind of kinds) {
        const document = createImageDocument('Pair', 32, 24, 'unused');
        const bottom = node(bottomKind, `Bottom ${bottomKind}`);
        const top = node(topKind, `Top ${topKind}`);
        document.layers = [bottom, top];
        document.activeLayerId = top.id;
        const state = setup(document);

        expect(
          state.commands.mergeSelectedLayers([top.id, bottom.id]),
          `${bottomKind} below ${topKind}`
        ).toBe(true);
        expect(state.document().layers).toHaveLength(1);
        expect(state.document().layers[0]).toMatchObject({
          type: 'raster', name: `Top ${topKind}`
        });
        expect(state.dependencies.setError).toHaveBeenLastCalledWith(null);
      }
    }
  });

  it('bakes an active Grade layer into the raster layer below with Ctrl+E semantics', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    expect(state.commands.createAdjustmentLayer()).toBe(true);
    expect(state.document().layers.at(-1)?.type).toBe('adjustment');
    const sourceIds = state.document().layers.map((layer) => layer.id);
    const sourceDestinationId = sourceIds[0];

    expect(state.commands.mergeActiveLayerDown()).toBe(true);

    expect(state.renderer.mergeLayers).toHaveBeenLastCalledWith(
      expect.anything(),
      sourceIds,
      state.document().layers[0]!.id
    );
    expect(state.document().layers).toHaveLength(1);
    expect(state.document().layers[0]?.type).toBe('raster');
    expect(state.document().layers[0]?.id).not.toBe(sourceDestinationId);
    expect(state.historyEntries).toHaveLength(2);
  });

  it('explains why Merge Down cannot run instead of failing silently', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    expect(state.commands.mergeActiveLayerDown()).toBe(false);

    expect(state.dependencies.setError).toHaveBeenCalledWith(
      'The active layer has no layer below it to merge with.'
    );
  });

  it('rejects inversion when the active raster layer is pixel locked', () => {
    const unlocked = createImageDocument('Test', 32, 24, 'asset');
    const locked = setLayerLocked(unlocked, unlocked.activeLayerId!, true);
    const state = setup(locked);

    expect(state.commands.invertLayerColors(locked.activeLayerId!, 'pixels')).toBe(false);

    expect(state.renderer.beginLayerPixelEdit).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      expect.stringContaining('Unlock the target layer')
    );
  });

  it('inverts an explicit raster layer through one reversible GPU edit', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const layerId = state.document().activeLayerId!;
    const beforeRevision = state.document().revision;

    expect(state.commands.invertLayerColors(layerId, 'pixels')).toBe(true);

    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(layerId, 'pixels');
    expect(state.renderer.invertLayerColors).toHaveBeenCalledWith(layerId, 'pixels');
    expect(state.document().revision).toBeGreaterThan(beforeRevision);
    expect(state.historyEntries).toHaveLength(1);
  });

  it('copies selected pixels into one new raster layer and one history entry', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const sourceId = state.document().activeLayerId;

    expect(state.commands.layerViaCopy(sourceId!, createFullCanvasSelection(16, 12)))
      .toBe(state.document().activeLayerId);

    expect(state.renderer.copySelectedLayerContent).toHaveBeenCalledWith(
      expect.anything(),
      sourceId
    );
    expect(state.renderer.pasteSelectionClipboard).toHaveBeenCalledWith(
      state.document().activeLayerId
    );
    expect(state.document().layers).toHaveLength(2);
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(
      expect.objectContaining({ id: state.document().activeLayerId })
    );
    const committedLayer = state.document().layers.at(-1);
    expect(committedLayer?.type === 'raster' ? committedLayer.pixelRevision : null).toBe(1);
    expect(state.historyEntries).toHaveLength(1);
    expect(state.dependencies.setSelectionClipboardAvailable).toHaveBeenCalledWith(true);
  });

  it('removes a Layer Via Copy destination when history rejects the command', () => {
    const initial = createImageDocument('Layer Via Copy failure', 32, 24, 'asset');
    const state = setup(initial);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.layerViaCopy(
      initial.activeLayerId!, createFullCanvasSelection(16, 12)
    )).toBeNull();

    expect(state.document()).toBe(initial);
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.historyEntries).toHaveLength(0);
  });

  it('copies the complete explicit raster layer when no selection exists', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const sourceId = state.document().activeLayerId!;

    const copiedId = state.commands.layerViaCopy(sourceId, []);

    expect(copiedId).toBe(state.document().activeLayerId);
    expect(copiedId).not.toBe(sourceId);
    expect(state.renderer.duplicateLayerPixels).toHaveBeenCalledWith(sourceId, copiedId);
    expect(state.historyEntries).toHaveLength(1);
  });
});
