import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createTextLayer, rasterizeTextLayer } from '../document/documentCommands';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  createTextLayerNode,
  createVectorLayer,
  type LayerId,
  type LayerNode
} from '../document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../document/layerTree';
import { RasterDocumentOperations } from './RasterDocumentOperations';

const texture = (name: string) => ({ name }) as unknown as GPUTexture;
const layerId = (value: string) => value as LayerId;

describe('RasterDocumentOperations', () => {
  it('resolves the high-precision document-final texture into a linear raster destination', () => {
    const destinationId = layerId('flattened');
    const sourceView = { label: 'display source view' };
    const destinationView = { label: 'linear destination view' };
    const source = { createView: vi.fn(() => sourceView) } as unknown as GPUTexture;
    const destinationTexture = {
      createView: vi.fn(() => destinationView)
    } as unknown as GPUTexture;
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn()
    };
    const finish = vi.fn(() => 'flatten commands');
    const createBindGroup = vi.fn(() => ({ label: 'flatten bind group' }));
    const submit = vi.fn();
    const invalidateLayer = vi.fn();
    const releaseSubmittedResources = vi.fn();
    const pipeline = {
      getBindGroupLayout: vi.fn(() => ({ label: 'flatten layout' }))
    } as unknown as GPURenderPipeline;
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ beginRenderPass: vi.fn(() => pass), finish }),
        createBindGroup,
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: LayerId) => id === destinationId
          ? { texture: destinationTexture, width: 64, height: 32 }
          : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite: vi.fn(),
      invalidateLayer,
      releaseSubmittedResources
    });

    expect(operations.flattenRenderedImage(source, destinationId, pipeline)).toBe(true);
    expect(createBindGroup).toHaveBeenCalledWith(expect.objectContaining({
      entries: [{ binding: 0, resource: sourceView }]
    }));
    expect(pass.setPipeline).toHaveBeenCalledWith(pipeline);
    expect(pass.draw).toHaveBeenCalledWith(3);
    expect(submit).toHaveBeenCalledWith(['flatten commands']);
    expect(invalidateLayer).toHaveBeenCalledWith(destinationId);
    expect(releaseSubmittedResources).toHaveBeenCalledOnce();
  });

  it('duplicates raster and mask pixels and invalidates the destination cache', () => {
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const invalidateLayer = vi.fn();
    const source = {
      texture: texture('source'),
      width: 320,
      height: 180,
      maskTexture: texture('source mask'),
      maskId: 'mask-source'
    };
    const destination = {
      texture: texture('destination'),
      width: 320,
      height: 180,
      maskTexture: texture('destination mask'),
      maskId: 'mask-destination'
    };
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({
          copyTextureToTexture,
          finish: () => 'commands'
        }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: string) => id === 'source' ? source : destination
      } as never,
      dimensions: () => ({ width: 1920, height: 1080 }),
      encodeComposite: vi.fn(),
      invalidateLayer,
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.duplicate(layerId('source'), layerId('destination'))).toBe(true);
    expect(copyTextureToTexture).toHaveBeenCalledTimes(2);
    expect(copyTextureToTexture).toHaveBeenNthCalledWith(
      1,
      { texture: source.texture },
      { texture: destination.texture },
      [320, 180]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
    expect(invalidateLayer).toHaveBeenCalledWith('destination');
  });

  it('does not allocate commands for an invalid merge set', () => {
    const createCommandEncoder = vi.fn();
    const operations = new RasterDocumentOperations({
      device: { createCommandEncoder } as unknown as GPUDevice,
      layerResources: {
        raster: () => null
      } as never,
      dimensions: () => ({ width: 10, height: 10 }),
      encodeComposite: vi.fn(),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(
      { layers: [] } as never,
      [layerId('missing-a'), layerId('missing-b')],
      layerId('missing-a')
    )).toBe(false);
    expect(createCommandEncoder).not.toHaveBeenCalled();
  });

  it('composites a cached vector presentation into the raster destination', () => {
    const document = createImageDocument('Shape merge', 64, 32, 'background');
    const vector = createVectorLayer([], 'Shape');
    document.layers.push(vector);
    const destinationId = document.layers[0]!.id;
    const destinationTexture = texture('destination');
    const compositeTexture = texture('vector composite');
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const encodeComposite = vi.fn(() => compositeTexture);
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: string) => id === destinationId
          ? {
              texture: destinationTexture,
              width: 64,
              height: 32,
              maskTexture: null,
              maskId: null
            } : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite,
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(document, [destinationId, vector.id], destinationId)).toBe(true);
    expect(encodeComposite).toHaveBeenCalledWith(expect.anything(), {
      ...document, layers: [document.layers[0], vector]
    }, undefined);
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: compositeTexture }, { texture: destinationTexture }, [64, 32]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
  });

  it('recursively composites selected groups with raster child content', () => {
    const document = createImageDocument('Group merge', 64, 32, 'background');
    const child = document.layers[0]!;
    const group = createGroupLayer('Artwork');
    group.children = [child];
    const vector = createVectorLayer([], 'Shape');
    document.layers = [group, vector];
    document.activeLayerId = vector.id;
    const destinationId = layerId('merged-destination');
    const destinationTexture = texture('destination');
    const childTexture = texture('child');
    const compositeTexture = texture('group composite');
    const copyTextureToTexture = vi.fn();
    const encodeComposite = vi.fn(() => compositeTexture);
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit: vi.fn() }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: string) => id === destinationId
          ? { texture: destinationTexture, width: 64, height: 32, maskTexture: null, maskId: null }
          : id === child.id
            ? { texture: childTexture, width: 64, height: 32, maskTexture: null, maskId: null }
            : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite,
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(document, [group.id, vector.id], destinationId)).toBe(true);
    expect(encodeComposite).toHaveBeenCalledWith(expect.anything(), {
      ...document, layers: [group, vector]
    }, undefined);
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: compositeTexture }, { texture: destinationTexture }, [64, 32]
    );
  });

  it('submits every ordered semantic pair with real authored content to one compositor path', () => {
    type Kind = 'raster' | 'shape' | 'gradient' | 'adjustment' | 'text' | 'group';
    const kinds: readonly Kind[] = [
      'raster', 'shape', 'gradient', 'adjustment', 'text', 'group'
    ];
    const rasterRuntime = {
      texture: texture('source raster'), width: 64, height: 32, maskTexture: null, maskId: null
    };
    const destinationRuntime = {
      texture: texture('destination'), width: 64, height: 32, maskTexture: null, maskId: null
    };
    const node = (kind: Kind, name: string): LayerNode => {
      if (kind === 'raster') {
        return { ...createImageDocument(name, 64, 32, `asset-${name}`).layers[0]!, name };
      }
      if (kind === 'shape' || kind === 'gradient') {
        const geometry = kind === 'shape'
          ? {
              kind: 'rectangle' as const,
              width: 24,
              height: 16,
              cornerRadii: [0, 0, 0, 0] as [number, number, number, number],
              linkedCorners: true
            }
          : { kind: 'ellipse' as const, width: 24, height: 16 };
        return createVectorLayer([
          createVectorLiveShape(`shape-${name}`, geometry, name)
        ], name, kind === 'gradient' ? 'gradient-fill' : 'artwork');
      }
      if (kind === 'adjustment') return createAdjustmentLayer(
        createAdjustmentStackFromBasicAdjustments({
          ...createDefaultAdjustments(), exposureEV: 1
        }),
        name
      );
      if (kind === 'text') {
        return createTextLayerNode(createDefaultTextLayerData(), name);
      }
      const group = createGroupLayer(name);
      group.children = [node('raster', `${name} child`)];
      return group;
    };

    for (const bottomKind of kinds) {
      for (const topKind of kinds) {
        const bottom = node(bottomKind, `Bottom ${bottomKind}`);
        const top = node(topKind, `Top ${topKind}`);
        const document = createImageDocument('Merge matrix', 64, 32, 'unused');
        document.layers = [bottom, top];
        document.activeLayerId = top.id;
        const destinationId = layerId(`destination-${bottomKind}-${topKind}`);
        const copyTextureToTexture = vi.fn();
        const encodeComposite = vi.fn(() => texture('pair composite'));
        const encodeAdjustment = vi.fn();
        const operations = new RasterDocumentOperations({
          device: {
            createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
            queue: { submit: vi.fn() }
          } as unknown as GPUDevice,
          layerResources: {
            raster: (id: LayerId) => id === destinationId
              ? destinationRuntime
              : findDocumentLayer(document, id)?.type === 'raster'
                ? rasterRuntime
                : null
          } as never,
          dimensions: () => ({ width: 64, height: 32 }),
          encodeComposite,
          invalidateLayer: vi.fn(),
          releaseSubmittedResources: vi.fn(),
          textSourceReady: vi.fn(() => true)
        });

        expect(
          operations.merge(document, [bottom.id, top.id], destinationId, encodeAdjustment),
          `${bottomKind} below ${topKind}`
        ).toBe(true);
        expect(encodeComposite).toHaveBeenCalledWith(
          expect.anything(), { ...document, layers: [bottom, top] }, encodeAdjustment
        );
        expect(copyTextureToTexture).toHaveBeenCalledWith(
          { texture: expect.anything() }, { texture: destinationRuntime.texture }, [64, 32]
        );
      }
    }
  });

  it('refuses merge and flatten before submission when a nested raster source is unavailable', () => {
    const document = createImageDocument('Missing runtime', 64, 32, 'background');
    const source = document.layers[0]!;
    const group = createGroupLayer('Group');
    group.children = [source];
    const vector = createVectorLayer([], 'Shape');
    document.layers = [group, vector];
    const destinationId = layerId('destination');
    const createCommandEncoder = vi.fn();
    const operations = new RasterDocumentOperations({
      device: { createCommandEncoder } as unknown as GPUDevice,
      layerResources: {
        raster: (id: LayerId) => id === destinationId
          ? { texture: texture('destination'), width: 64, height: 32 }
          : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite: vi.fn(),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(document, [group.id, vector.id], destinationId)).toBe(false);
    expect(operations.flattenGroup(document, group.id, destinationId)).toBe(false);
    expect(operations.flattenImage(document, destinationId)).toBe(false);
    expect(createCommandEncoder).not.toHaveBeenCalled();
  });

  it('does not require GPU runtimes for hidden raster branches that cannot contribute', () => {
    const document = createImageDocument('Lazy hidden content', 64, 32, 'background');
    const hiddenChild = document.layers[0]!;
    hiddenChild.visible = false;
    const group = createGroupLayer('Lazy group');
    group.children = [hiddenChild];
    const vector = createVectorLayer([
      createVectorLiveShape('visible-shape', {
        kind: 'ellipse', width: 20, height: 12
      }, 'Visible shape')
    ], 'Shape');
    document.layers = [group, vector];
    const destinationId = layerId('destination');
    const destination = {
      texture: texture('destination'), width: 64, height: 32, maskTexture: null, maskId: null
    };
    const composite = texture('composite');
    const copyTextureToTexture = vi.fn();
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit: vi.fn() }
      } as unknown as GPUDevice,
      layerResources: {
        raster: (id: LayerId) => id === destinationId ? destination : null
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite: vi.fn(() => composite),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn()
    });

    expect(operations.merge(document, [group.id, vector.id], destinationId)).toBe(true);
    expect(operations.flattenGroup(document, group.id, destinationId)).toBe(true);
    expect(operations.flattenImage(document, destinationId)).toBe(true);
    expect(copyTextureToTexture).toHaveBeenCalledTimes(3);
  });

  it('renders isolated normalized text into its prepared same-ID raster destination', () => {
    const document = createTextLayer(
      createImageDocument('Text', 64, 32, 'background'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const source = findDocumentLayer(document, document.activeLayerId);
    const destinationDocument = rasterizeTextLayer(document, document.activeLayerId!);
    const destination = findRasterLayer(destinationDocument, document.activeLayerId!);
    if (source?.type !== 'text' || !destination) throw new Error('Expected text rasterization fixtures.');
    const destinationTexture = texture('destination');
    const compositeTexture = texture('composite');
    const ensureRaster = vi.fn(() => ({
      texture: destinationTexture,
      maskTexture: null,
      maskId: null
    }));
    const copyTextureToTexture = vi.fn();
    const submit = vi.fn();
    const encodeComposite = vi.fn(() => compositeTexture);
    const releaseSubmittedResources = vi.fn();
    const invalidateLayer = vi.fn();
    const layerResources = {
      hasRaster: vi.fn(() => false),
      ensureRaster,
      raster: vi.fn(() => ({ texture: destinationTexture, maskTexture: null, maskId: null })),
      releaseRaster: vi.fn(() => true)
    };
    const operations = new RasterDocumentOperations({
      device: {
        createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
        queue: { submit }
      } as unknown as GPUDevice,
      layerResources: layerResources as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite,
      invalidateLayer,
      releaseSubmittedResources
    });

    expect(operations.prepareRasterDestination(destination)).toBe(true);
    expect(operations.rasterizeText(document, source, destination)).toBe(true);

    expect(ensureRaster).toHaveBeenCalledWith(destination);
    expect(encodeComposite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        layers: [expect.objectContaining({
          id: source.id,
          type: 'text',
          opacity: 1,
          fillOpacity: 1,
          blendMode: 'normal',
          clipping: false,
          mask: null
        })]
      })
    );
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: compositeTexture },
      { texture: destinationTexture },
      [64, 32]
    );
    expect(submit).toHaveBeenCalledWith(['commands']);
    expect(releaseSubmittedResources).toHaveBeenCalledOnce();
    expect(invalidateLayer).toHaveBeenCalledWith(destination.id);

    expect(operations.releaseRasterDestination(destination.id)).toBe(true);
    expect(layerResources.releaseRaster).toHaveBeenCalledWith(destination.id, true);
  });

  it('performs an exact zero-submit bypass while a text source is unready', () => {
    const document = createTextLayer(
      createImageDocument('Text', 64, 32, 'background'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const source = findDocumentLayer(document, document.activeLayerId);
    const destination = findRasterLayer(
      rasterizeTextLayer(document, document.activeLayerId!),
      document.activeLayerId!
    );
    if (source?.type !== 'text' || !destination) throw new Error('Expected text fixtures.');
    const createCommandEncoder = vi.fn();
    const submit = vi.fn();
    const operations = new RasterDocumentOperations({
      device: { createCommandEncoder, queue: { submit } } as unknown as GPUDevice,
      layerResources: {
        raster: vi.fn(() => ({ texture: texture('destination'), maskTexture: null }))
      } as never,
      dimensions: () => ({ width: 64, height: 32 }),
      encodeComposite: vi.fn(),
      invalidateLayer: vi.fn(),
      releaseSubmittedResources: vi.fn(),
      textSourceReady: vi.fn(() => false)
    });

    expect(operations.rasterizeText(document, source, destination)).toBe(false);
    expect(createCommandEncoder).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
