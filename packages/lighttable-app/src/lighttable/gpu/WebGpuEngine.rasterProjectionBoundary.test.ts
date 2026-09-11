import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type RasterLayer } from '../editor/document/documentTypes';
import { WebGpuEngine } from './WebGpuEngine';
import { LayerDocumentRenderer } from '../editor/rendering/LayerDocumentRenderer';
import { LayerRuntimeStore } from '../editor/rendering/LayerRuntimeStore';
import { LayerRuntimeCoordinator } from '../editor/rendering/LayerRuntimeCoordinator';
import { DocumentLayerResourceRepository } from '../editor/rendering/DocumentLayerResourceRepository';

const texture = () => ({ destroy: vi.fn() }) as unknown as GPUTexture;

const fixture = () => {
  const before = createImageDocument('test', 64, 32, 'source');
  const layer = before.layers[0] as RasterLayer;
  const after = { ...before, width: 128, layers: [{ ...layer, width: 128 }] };
  const store = new LayerRuntimeStore({ createRasterTexture: texture, createMaskTexture: texture });
  store.bind('session');
  store.sync(before.layers);
  const pixels = store.raster(layer.id)!.texture;
  const renderer = Object.assign(Object.create(LayerDocumentRenderer.prototype), {
    document: before,
    documentResourceKey: 'session',
    runtime: {
      layerResources: store,
      layerRuntimeCoordinator: new LayerRuntimeCoordinator({ store, invalidateLayer: vi.fn() })
    }
  }) as LayerDocumentRenderer;
  return { before, after, layer, store, pixels, renderer };
};

describe('raster projection publication boundary', () => {
  it.each(['setDocument', 'resizeDocumentSurface', 'synchronizeDocumentForExport'] as const)(
    '%s rejects mismatched pixels before publishing state or touching derived resources', (method) => {
      const { before, after, pixels, renderer } = fixture();
      const engine = Object.assign(Object.create(WebGpuEngine.prototype), {
        imageDocument: before,
        metadata: { width: 64, height: 32 },
        imageResources: { sourceTexture: texture() },
        documentRenderer: renderer
      }) as WebGpuEngine;

      expect(() => engine[method](after)).toThrow(/pixel surface.*64x32.*128x32/i);
      expect((engine as unknown as { imageDocument: unknown }).imageDocument).toBe(before);
      expect((renderer as unknown as { document: unknown }).document).toBe(before);
      expect(pixels.destroy).not.toHaveBeenCalled();
    }
  );

  it('direct renderer sync also rejects before changing its document', () => {
    const { before, after, pixels, renderer } = fixture();
    expect(() => renderer.syncDocument(after)).toThrow(/pixel surface/i);
    expect((renderer as unknown as { document: unknown }).document).toBe(before);
    expect(pixels.destroy).not.toHaveBeenCalled();
  });

  it('preflights the addressed repository without rebinding the current one', () => {
    const repository = new DocumentLayerResourceRepository();
    const store = new LayerRuntimeStore(
      { createRasterTexture: texture, createMaskTexture: texture }, repository, 'first'
    );
    const document = createImageDocument('test', 64, 32, 'source');
    const layer = document.layers[0] as RasterLayer;
    store.sync([layer]);
    const firstPixels = store.raster(layer.id)!.texture;
    store.bind('second');
    store.sync([{ ...layer, width: 128 }]);
    const secondPixels = store.raster(layer.id)!.texture;
    expect(() => store.assertRasterSurfacesMatch([layer], 'first')).not.toThrow();
    expect(() => store.assertRasterSurfacesMatch([layer], 'second')).toThrow(/pixel surface/i);
    expect(store.raster(layer.id)!.texture).toBe(secondPixels);
    expect(firstPixels.destroy).not.toHaveBeenCalled();
    expect(secondPixels.destroy).not.toHaveBeenCalled();
  });
});
