import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createRasterLayer, createTextLayer, setLayerLocked } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  createVectorLayer,
  type ImageDocument
} from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import {
  createFeatherSelectionOperation,
  createFullCanvasSelection
} from '../../editor/selection/selectionTypes';
import { cloneAdjustments, createDefaultAdjustments } from '../../types';
import {
  createLayerDocumentCommands,
  type LayerCommandHistoryEntry,
  type LayerCommandRendererPort
} from './useLayerDocumentCommands';

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

const renderer = (edit: ReversiblePixelEdit = pixelEdit()): LayerCommandRendererPort => ({
  duplicateLayerPixels: vi.fn(),
  beginLayerPixelEdit: vi.fn(),
  mergeLayers: vi.fn(() => true),
  flattenGroup: vi.fn(() => true),
  flattenImage: vi.fn(() => true),
  prepareRasterDestination: vi.fn(() => true),
  loadLayerAssets: vi.fn(async () => undefined),
  commitRasterDestination: vi.fn(),
  releaseRasterDestination: vi.fn(() => true),
  rasterizeText: vi.fn(() => true),
  invertLayerColors: vi.fn(() => true),
  bakeSelectionIntoLayerMask: vi.fn(() => true),
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
  const dependencies = {
    getDocument: () => document,
    getRenderer: () => activeRenderer,
    getImageClipboard: () => imageClipboard,
    getDocumentId: () => 'test-document',
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
    })
  };
  const commands = createLayerDocumentCommands(() => dependencies);
  return {
    commands,
    dependencies,
    renderer: activeRenderer,
    imageClipboard,
    historyEntries,
    document: () => document,
    documentAdjustments: () => documentAdjustments,
    panelAdjustments: () => panelAdjustments
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
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('mask');
    expect(state.document().activeLayerId).toBe(layerId);
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

  it('copies selected layer pixels to the system image clipboard', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const selection = createFullCanvasSelection(32, 24);

    await expect(state.commands.copySelectedContent(selection)).resolves.toBe(true);

    expect(state.renderer.copySelectedLayerContent).toHaveBeenCalledOnce();
    expect(state.renderer.exportSelectionClipboard).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 32,
      height: 24
    });
    expect(state.imageClipboard.writeImage).toHaveBeenCalledOnce();
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

    await expect(state.commands.copySelectedContent(selection)).resolves.toBe(true);

    const support = { x: 0, y: 0, width: 86, height: 71 };
    expect(state.renderer.exportSelectionClipboard).toHaveBeenCalledWith(support);
    expect(state.imageClipboard.writeImage).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining(support)
    );
  });

  it('copies the visible composited result for Copy Merged', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    await expect(
      state.commands.copyMergedContent(createFullCanvasSelection(32, 24))
    ).resolves.toBe(true);

    expect(state.renderer.exportMergedSelection).toHaveBeenCalledOnce();
    expect(state.renderer.copySelectedLayerContent).not.toHaveBeenCalled();
    expect(state.imageClipboard.writeImage).toHaveBeenCalledOnce();
  });

  it('pastes an external clipboard image into a new layer', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));

    await expect(state.commands.pasteSelectedContent([])).resolves.toBe(true);

    expect(state.renderer.pasteClipboardImage).toHaveBeenCalledOnce();
    expect(state.renderer.pasteSelectionClipboard).not.toHaveBeenCalled();
    expect(state.document().layers).toHaveLength(2);
  });

  it('places an external clipboard image at the active selection origin', async () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const selection = createFullCanvasSelection(16, 12);

    await expect(state.commands.pasteSelectedContent(selection)).resolves.toBe(true);

    expect(state.renderer.pasteClipboardImage).toHaveBeenCalledWith(
      state.document().activeLayerId,
      expect.any(Blob),
      { x: 0, y: 0 }
    );
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
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
    expect(state.dependencies.setActiveChannel).toHaveBeenCalledWith('pixels');
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
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
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
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
  });

  it('rasterizes fixture text as one recoverable GPU and document transaction', () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    const layerId = state.document().activeLayerId!;

    expect(state.commands.rasterizeActiveTextLayer()).toBe(true);

    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(
      expect.objectContaining({ id: layerId, type: 'raster' })
    );
    expect(state.renderer.beginLayerPixelEdit).toHaveBeenCalledWith(layerId);
    expect(state.renderer.rasterizeText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: layerId, type: 'text' }),
      expect.objectContaining({ id: layerId, type: 'raster' })
    );
    expect(state.document().layers.at(-1)).toMatchObject({ id: layerId, type: 'raster' });
    expect(state.historyEntries).toHaveLength(1);

    state.historyEntries[0].undo();
    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.renderer.applyPixelHistory).toHaveBeenLastCalledWith(expect.anything(), 'undo');
    state.historyEntries[0].redo();
    expect(state.document().layers.at(-1)?.type).toBe('raster');
    expect(state.renderer.applyPixelHistory).toHaveBeenLastCalledWith(expect.anything(), 'redo');
  });

  it('rolls back a failed GPU text rasterization without document history', () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    vi.mocked(state.renderer.rasterizeText).mockReturnValue(false);

    expect(state.commands.rasterizeActiveTextLayer()).toBe(false);

    expect(state.renderer.cancelPixelEdit).toHaveBeenCalledOnce();
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.historyEntries).toEqual([]);
  });

  it('releases a reserved raster when no reversible pixel edit can be created', () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    vi.mocked(state.renderer.finishPixelEdit).mockReturnValue(null);

    expect(state.commands.rasterizeActiveTextLayer()).toBe(false);

    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.historyEntries).toEqual([]);
  });

  it('restores GPU pixels and the text snapshot when history publication throws', () => {
    const state = setup(createTextLayer(
      createImageDocument('Test', 32, 24, 'asset'),
      createDefaultTextLayerData(),
      'Text fixture'
    ));
    const edit = vi.mocked(state.renderer.finishPixelEdit).getMockImplementation()!();
    vi.mocked(state.renderer.finishPixelEdit).mockReturnValue(edit);
    vi.mocked(state.dependencies.pushHistoryEntry).mockImplementation(() => {
      throw new Error('History unavailable.');
    });

    expect(state.commands.rasterizeActiveTextLayer()).toBe(false);

    expect(edit?.undo).toHaveBeenCalledOnce();
    expect(edit?.destroy).toHaveBeenCalledOnce();
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledOnce();
    expect(state.document().layers.at(-1)?.type).toBe('text');
    expect(state.dependencies.setError).toHaveBeenLastCalledWith('History unavailable.');
  });

  it('creates a Grade layer as one reversible document transaction', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    state.panelAdjustments().exposureEV = 1.25;

    expect(state.commands.createAdjustmentLayer()).toBe(true);

    expect(state.document().layers.at(-1)?.type).toBe('adjustment');
    // A new Grade Layer is an explicit, neutral owner. It must not silently
    // steal an unrelated panel value from the previously selected raster layer.
    expect(state.panelAdjustments().exposureEV).toBe(0);
    expect(state.documentAdjustments().exposureEV).toBe(0);
    expect(state.historyEntries).toHaveLength(1);

    state.historyEntries[0].undo();
    expect(state.document().layers).toHaveLength(1);
    expect(state.panelAdjustments().exposureEV).toBe(1.25);

    state.historyEntries[0].redo();
    expect(state.document().layers.at(-1)?.type).toBe('adjustment');
    expect(state.panelAdjustments().exposureEV).toBe(0);
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

  it('merges contiguous tight raster layers into a reversible full-canvas destination', () => {
    const first = createImageDocument('Test', 32, 24, 'asset');
    const state = setup(createRasterLayer(first, 'Top'));
    const layerIds = state.document().layers.map((layer) => layer.id);

    expect(state.commands.mergeSelectedRasterLayers(layerIds)).toBe(true);

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

    expect(state.commands.flatten({ kind: 'image' })).toBe(true);

    const destination = state.document().layers[0];
    expect(destination).toMatchObject({ type: 'raster', width: 32, height: 24 });
    expect(sourceIds).not.toContain(destination?.id);
    expect(state.renderer.prepareRasterDestination).toHaveBeenCalledWith(destination);
    expect(state.renderer.flattenImage).toHaveBeenCalledWith(
      expect.anything(), destination?.id
    );
    expect(state.historyEntries).toHaveLength(1);
    state.historyEntries[0].undo();
    expect(state.document().layers.map(({ id }) => id)).toEqual(sourceIds);
    state.historyEntries[0].redo();
    expect(state.document().layers[0]?.id).toBe(destination?.id);
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

    expect(state.commands.mergeSelectedRasterLayers([pixels.id, shape.id])).toBe(true);

    const merged = state.document().layers[1]!;
    expect(state.renderer.mergeLayers).toHaveBeenCalledWith(
      expect.anything(), [shape.id, pixels.id], merged.id
    );
    expect(merged).toMatchObject({ type: 'raster', name: 'Pixels', width: 32, height: 24 });
    expect(state.historyEntries).toHaveLength(1);
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

    expect(state.commands.invertActiveLayerColors('pixels')).toBe(false);

    expect(state.renderer.beginLayerPixelEdit).not.toHaveBeenCalled();
    expect(state.dependencies.setError).toHaveBeenCalledWith(
      expect.stringContaining('Unlock the active layer')
    );
  });

  it('copies selected pixels into one new raster layer and one history entry', () => {
    const state = setup(createImageDocument('Test', 32, 24, 'asset'));
    const sourceId = state.document().activeLayerId;

    expect(state.commands.layerViaCopy(createFullCanvasSelection(16, 12))).toBe(true);

    expect(state.renderer.copySelectedLayerContent).toHaveBeenCalledWith(
      expect.anything(),
      sourceId
    );
    expect(state.renderer.pasteSelectionClipboard).toHaveBeenCalledWith(
      state.document().activeLayerId
    );
    expect(state.document().layers).toHaveLength(2);
    expect(state.dependencies.pushDocumentHistory).toHaveBeenCalledOnce();
    expect(state.dependencies.setSelectionClipboardAvailable).toHaveBeenCalledWith(true);
  });
});
