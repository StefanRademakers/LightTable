import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import type {
  DocumentAssetId,
  LayerId,
  RasterLayer
} from '../document/documentTypes';
import {
  createImageDocument,
  createTextLayerNode,
  semanticLayerDependencyKey
} from '../document/documentTypes';
import type { DocumentAssetBlob } from '../persistence/layeredDocumentFormat';
import { LayerDocumentAssetService, type LayerDocumentAssetPorts } from './LayerDocumentAssetService';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { selectAdjustmentLayerModules } from '../../processing/adjustmentLayerCatalog';

const patternId = 'pattern-1' as DocumentAssetId;
const texture = { label: 'pixels' } as GPUTexture;
const maskTexture = { label: 'mask' } as GPUTexture;
const pixels = new Blob(['pixels']);
const mask = new Blob(['mask']);
const pattern = new Blob(['pattern']);

const documentWith = () => {
  const document = createImageDocument('Assets', 64, 32, 'source');
  document.assets.patterns = [{
    id: patternId,
    name: 'Dots',
    width: 8,
    height: 8,
    revision: 0
  }];
  return document;
};

const createPorts = (): LayerDocumentAssetPorts => ({
  rasterTexture: vi.fn(() => texture),
  derivedPreviewTexture: vi.fn(() => null),
  maskTexture: vi.fn(() => maskTexture),
  encodeTexture: vi.fn(async (_layerId, _texture, maskChannel) => maskChannel ? mask : pixels),
  encodeSemanticLayer: vi.fn(async () => pixels),
  encodeProcessedRasterLayer: vi.fn(async () => pixels),
  decodeTexture: vi.fn(async () => undefined),
  invalidateLayer: vi.fn(),
  patternSource: vi.fn(() => pattern),
  loadPattern: vi.fn(async () => undefined)
});

describe('LayerDocumentAssetService', () => {
  it('exports raster pixels, optional masks and immutable patterns', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    const layerId = layer.id;
    layer.mask = {
      id: 'mask-1',
      enabled: true,
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };

    const assets = await service.export(document);

    expect(assets).toEqual([
      { layerId, pixels, mask },
      { patternId, source: pattern }
    ]);
    expect(ports.encodeTexture).toHaveBeenNthCalledWith(1, layerId, texture, false);
    expect(ports.encodeTexture).toHaveBeenNthCalledWith(2, layerId, maskTexture, true);
  });

  it('routes persisted assets to their canonical GPU destinations', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const layerId = 'layer-1' as LayerId;
    const assets: DocumentAssetBlob[] = [
      { layerId, pixels, mask },
      { patternId, source: pattern },
      { sourceId: 'source-1' as DocumentAssetId, source: new Blob(['preserved']) }
    ];

    await service.load(assets);

    expect(ports.invalidateLayer).toHaveBeenCalledOnce();
    expect(ports.decodeTexture).toHaveBeenNthCalledWith(1, layerId, pixels, texture, false);
    expect(ports.decodeTexture).toHaveBeenNthCalledWith(2, layerId, mask, maskTexture, true);
    expect(ports.loadPattern).toHaveBeenCalledWith({ patternId, source: pattern });
  });

  it('reuses unchanged encoded native assets and invalidates on pixel revision or load', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;

    await service.export(document);
    await service.export(document);
    expect(ports.encodeTexture).toHaveBeenCalledTimes(1);

    layer.pixelRevision += 1;
    await service.export(document);
    expect(ports.encodeTexture).toHaveBeenCalledTimes(2);

    await service.load([{ layerId: layer.id, pixels, mask: null }]);
    await service.export(document);
    expect(ports.encodeTexture).toHaveBeenCalledTimes(3);
  });

  it('bakes affine raster transforms into tight PSD export bounds', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    layer.transform = { a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 20 };

    const assets = await service.exportPsd(document);

    expect(assets).toEqual([{
      layerId: layer.id,
      bounds: { x: 68, y: 20, width: 32, height: 64 },
      pixels,
      mask: null
    }]);
    expect(ports.encodeTexture).toHaveBeenCalledWith(
      layer.id,
      texture,
      false,
      {
        width: 32,
        height: 64,
        sourceToOutput: { a: 0, b: 1, c: -1, d: 0, tx: 32, ty: 0 }
      }
    );
  });

  it('bakes the local adjustment stack before exporting PSD raster pixels', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    layer.adjustmentStack = { id: 'processed-raster', revision: 1, modules: [] };
    const encodeAdjustment = vi.fn((_encoder, source) => source);

    await service.exportPsd(document, encodeAdjustment);

    expect(ports.encodeProcessedRasterLayer).toHaveBeenCalledWith(
      document,
      layer,
      encodeAdjustment,
      {
        width: 64,
        height: 32,
        sourceToOutput: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
      }
    );
    expect(ports.encodeTexture).not.toHaveBeenCalledWith(
      layer.id,
      texture,
      false,
      expect.anything()
    );
  });

  it('keeps editable attached Photoshop adjustments out of the baked PSD base pixels', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    const values = createDefaultAdjustments();
    values.photoshopAdjustment.kind = 'levels';
    layer.attachedAdjustments = [{
      id: 'attached-levels', adjustmentKind: 'levels', name: 'Levels',
      enabled: true, revision: 0,
      adjustmentStack: selectAdjustmentLayerModules(
        createAdjustmentStackFromBasicAdjustments(values), 'levels'
      )
    }];

    await service.exportPsd(document, vi.fn((_encoder, source) => source));

    expect(ports.encodeProcessedRasterLayer).not.toHaveBeenCalled();
    expect(ports.encodeTexture).toHaveBeenCalledWith(
      layer.id, texture, false,
      expect.objectContaining({ width: 64, height: 32 })
    );
  });

  it('bakes unsupported attached processing exactly once into PSD base pixels', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const document = documentWith();
    const layer = document.layers[0] as RasterLayer;
    const values = createDefaultAdjustments();
    values.exposureEV = 1;
    layer.attachedAdjustments = [{
      id: 'attached-grade', adjustmentKind: 'grade', name: 'Local Grade',
      enabled: true, revision: 1,
      adjustmentStack: createAdjustmentStackFromBasicAdjustments(values)
    }];
    const encodeAdjustment = vi.fn((_encoder, source) => source);

    await service.exportPsd(document, encodeAdjustment);

    expect(ports.encodeProcessedRasterLayer).toHaveBeenCalledOnce();
    expect(ports.encodeProcessedRasterLayer).toHaveBeenCalledWith(
      document,
      expect.objectContaining({
        id: layer.id,
        attachedAdjustments: [expect.objectContaining({ id: 'attached-grade' })]
      }),
      encodeAdjustment,
      expect.objectContaining({ width: 64, height: 32 })
    );
    expect(ports.encodeTexture).not.toHaveBeenCalledWith(
      layer.id, texture, false, expect.anything()
    );
  });

  it('exports and loads semantic preview pixels through their derived GPU destination', async () => {
    const previewTexture = { label: 'preview' } as GPUTexture;
    const ports = createPorts();
    ports.rasterTexture = vi.fn(() => null);
    ports.derivedPreviewTexture = vi.fn(() => previewTexture);
    const service = new LayerDocumentAssetService(ports);
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Cached text');
    text.derivedPreview = {
      width: 16,
      height: 9,
      transform: text.transform,
      dependencyKey: semanticLayerDependencyKey(text)!,
      source: 'photoshop-layer-preview'
    };
    const document = { ...documentWith(), layers: [text], activeLayerId: text.id };

    const assets = await service.export(document);
    await service.load(assets);

    expect(assets).toEqual([
      { layerId: text.id, pixels, mask: null },
      { patternId, source: pattern }
    ]);
    expect(ports.encodeTexture).toHaveBeenCalledWith(text.id, previewTexture, false);
    expect(ports.decodeTexture).toHaveBeenCalledWith(text.id, pixels, previewTexture, false);
  });

  it('materializes an intrinsic GPU fallback for semantic PSD layers without a preview cache', async () => {
    const ports = createPorts();
    const service = new LayerDocumentAssetService(ports);
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Editable text');
    text.derivedPreview = null;
    const document = { ...documentWith(), layers: [text], activeLayerId: text.id };

    const assets = await service.exportPsd(document);

    expect(assets).toEqual([{
      layerId: text.id,
      bounds: { x: 0, y: 0, width: document.width, height: document.height },
      pixels,
      mask: null
    }]);
    expect(ports.encodeSemanticLayer).toHaveBeenCalledWith(document, text);
  });

  it('fails before silently dropping unavailable raster pixels', async () => {
    const ports = createPorts();
    ports.rasterTexture = vi.fn(() => null);
    const service = new LayerDocumentAssetService(ports);
    const layerId = 'layer-1' as LayerId;

    await expect(service.load([{ layerId, pixels, mask: null }]))
      .rejects.toThrow(`Layer ${layerId} is not available while opening the document.`);
  });
});
