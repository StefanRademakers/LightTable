import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer, setLayerLocked } from '../../editor/document/documentCommands';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../editor/rendering/LayerDocumentRenderer';
import { createFullCanvasSelection } from '../../editor/selection/selectionTypes';
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
  invertLayerColors: vi.fn(() => true),
  copySelectedLayerContent: vi.fn(() => true),
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
  const dependencies = {
    getDocument: () => document,
    getRenderer: () => activeRenderer,
    applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
      document = next;
    }),
    pushDocumentHistory: vi.fn(),
    pushHistoryEntry: vi.fn((entry: LayerCommandHistoryEntry) => historyEntries.push(entry)),
    setActiveChannel: vi.fn(),
    setSelectionClipboardAvailable: vi.fn(),
    setStatus: vi.fn(),
    setError: vi.fn()
  };
  const commands = createLayerDocumentCommands(() => dependencies);
  return {
    commands,
    dependencies,
    renderer: activeRenderer,
    historyEntries,
    document: () => document
  };
};

describe('useLayerDocumentCommands', () => {
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

  it('merges contiguous raster layers with recoverable pixel history', () => {
    const first = createImageDocument('Test', 32, 24, 'asset');
    const state = setup(createRasterLayer(first, 'Top'));
    const layerIds = state.document().layers.map((layer) => layer.id);

    expect(state.commands.mergeSelectedRasterLayers(layerIds)).toBe(true);

    expect(state.document().layers).toHaveLength(1);
    expect(state.historyEntries).toHaveLength(1);
    state.historyEntries[0].undo();
    expect(state.document().layers).toHaveLength(2);
    expect(state.renderer.applyPixelHistory).toHaveBeenCalledWith(
      expect.anything(),
      'undo'
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
