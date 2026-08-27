import { describe, expect, it, vi } from 'vitest';
import {
  createGroupLayer,
  createImageDocument
} from '../../editor/document/documentTypes';
import type { DocumentAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import { parseLayeredDocumentFile } from '../../editor/persistence/layeredDocumentFormat';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  buildLightTableOutputName,
  canExportAsFlatRecipe,
  exportLightTableDocument,
  type DocumentExportRenderer
} from './exportLightTableDocument';

const rendererFixture = (): DocumentExportRenderer => ({
  exportPng: vi.fn(async () => new Blob(['preview'], { type: 'image/png' })),
  exportLayerAssets: vi.fn(async () => [] as DocumentAssetBlob[]),
  getAdjustmentStack: vi.fn(() =>
    createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()))
});

describe('LightTable document export policy', () => {
  it('builds stable PNG output names', () => {
    expect(buildLightTableOutputName('portrait.jpg')).toBe('portrait-lighttable.png');
    expect(buildLightTableOutputName('')).toBe('image-lighttable.png');
  });

  it('keeps a plain one-layer document on the flat recipe path', () => {
    expect(canExportAsFlatRecipe(createImageDocument('Flat', 16, 9, 'asset'))).toBe(true);
  });

  it('uses the native layered path when document structure must survive', () => {
    const document = createImageDocument('Layered', 16, 9, 'asset');
    document.layers.push(createGroupLayer('Group'));
    expect(canExportAsFlatRecipe(document)).toBe(false);
  });

  it('does not export preserved source payloads through a flat recipe', () => {
    const document = createImageDocument('Preserved', 16, 9, 'asset');
    document.assets.preservedSources.push({
      id: 'preserved-source' as never,
      kind: 'photoshop-document',
      name: 'source.psd',
      mediaType: 'image/vnd.adobe.photoshop',
      byteLength: 42
    });
    expect(canExportAsFlatRecipe(document)).toBe(false);
  });

  it('does not request layer assets for a flat export', async () => {
    const renderer = rendererFixture();
    const settings = createDefaultAdjustments();
    const output = await exportLightTableDocument({
      document: createImageDocument('Flat', 16, 9, 'asset'),
      renderer,
      recipeSourceKey: 'source-key',
      fileNameBase: 'source.jpg',
      flatAdjustments: settings,
      documentAdjustments: settings,
      effectiveLayeredAdjustments: settings,
      preservedSourceAssets: []
    });

    expect(output.file.name).toBe('source-lighttable.png');
    expect(output.recipe.documentFormat).toBeUndefined();
    expect(renderer.exportLayerAssets).not.toHaveBeenCalled();
  });

  it('forces a native authored boundary for duplicating a plain one-layer image', async () => {
    const document = createImageDocument('Flat', 16, 9, 'asset');
    const renderer = rendererFixture();
    vi.mocked(renderer.exportLayerAssets).mockResolvedValue([{
      layerId: document.layers[0]!.id,
      pixels: new Blob(['layer'], { type: 'image/png' }),
      mask: null
    }]);
    const settings = createDefaultAdjustments();
    const output = await exportLightTableDocument({
      document, renderer, recipeSourceKey: 'source-key', fileNameBase: 'source.jpg',
      flatAdjustments: settings, documentAdjustments: settings,
      effectiveLayeredAdjustments: settings, preservedSourceAssets: []
    }, { forceLayered: true });

    expect(output.recipe.documentFormat).toBe('embedded-layered-png');
    expect(renderer.exportLayerAssets).toHaveBeenCalledWith(document);
  });

  it('uses a 1x1 placeholder instead of a document-sized recovery preview', async () => {
    const created: Array<{ width: number; height: number }> = [];
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {
        created.push({ width, height });
      }
      convertToBlob = vi.fn(async () => new Blob(['placeholder'], { type: 'image/png' }));
    });
    try {
      const document = createImageDocument('Recovery', 12_000, 8_000, 'asset');
      const renderer = rendererFixture();
      vi.mocked(renderer.exportLayerAssets).mockResolvedValue([{
        layerId: document.layers[0]!.id,
        pixels: new Blob(['layer'], { type: 'image/png' }),
        mask: null
      }]);
      const settings = createDefaultAdjustments();
      const output = await exportLightTableDocument({
        document, renderer, recipeSourceKey: 'source-key', fileNameBase: 'recovery.png',
        flatAdjustments: settings, documentAdjustments: settings,
        effectiveLayeredAdjustments: settings, preservedSourceAssets: []
      }, { lightweightPreview: true });

      expect(created).toEqual([{ width: 1, height: 1 }]);
      expect(renderer.exportPng).not.toHaveBeenCalled();
      await expect(parseLayeredDocumentFile(output.file)).resolves.toMatchObject({
        previewKind: 'placeholder'
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
