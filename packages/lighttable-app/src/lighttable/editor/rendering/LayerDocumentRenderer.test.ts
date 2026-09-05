import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  createTextLayerNode,
  createVectorLayer,
  type LayerNode
} from '../document/documentTypes';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import {
  LayerDocumentRenderer,
  projectLayerMaskPresentation,
  projectTextEditingGeometryPreview
} from './LayerDocumentRenderer';

describe('layer mask presentation', () => {
  it('projects the shared mask channel for every canonical layer type', () => {
    const document = createImageDocument('test', 320, 180, 'source');
    const raster = document.layers[0];
    const adjustment = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade',
      'grade'
    );
    const group = createGroupLayer('Group');
    const vector = createVectorLayer([], 'Vector');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const layers: LayerNode[] = [raster, adjustment, group, vector, text];
    layers.forEach((layer, index) => {
      layer.mask = {
        id: `mask-${index}`,
        enabled: true,
        linked: true,
        transform: { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 14 },
        density: 1,
        feather: 0,
        revision: 0,
        pixelRevision: 0,
        dirtyBounds: null
      };
    });
    document.layers = layers;
    const texture = {} as GPUTexture;

    layers.forEach((layer) => {
      const presentation = projectLayerMaskPresentation(document, layer, texture);
      expect(presentation).toMatchObject({
        texture,
        canvasWidth: 320,
        canvasHeight: 180
      });
      expect(presentation?.inverseTransform).toMatchObject({
        a: 0.5, d: 0.5, tx: -5, ty: -7
      });
      expect(presentation?.inverseTransform.b).toBeCloseTo(0);
      expect(presentation?.inverseTransform.c).toBeCloseTo(0);
    });
  });

  it('does not invent a mask channel for layers without a mask', () => {
    const document = createImageDocument('test', 64, 64, 'source');
    expect(projectLayerMaskPresentation(document, document.layers[0], {} as GPUTexture))
      .toBeNull();
  });

  it('projects a transient mask transform without mutating document state', () => {
    const document = createImageDocument('test', 64, 64, 'source');
    const layer = document.layers[0];
    layer.mask = {
      id: 'mask',
      enabled: true,
      linked: false,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };

    const presentation = projectLayerMaskPresentation(
      document,
      layer,
      {} as GPUTexture,
      { a: 1, b: 0, c: 0, d: 1, tx: 7, ty: 9 }
    );

    expect(presentation?.inverseTransform).toMatchObject({ a: 1, d: 1, tx: -7, ty: -9 });
    expect(presentation?.inverseTransform.b).toBeCloseTo(0);
    expect(presentation?.inverseTransform.c).toBeCloseTo(0);
    expect(layer.mask.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  });
});

describe('text editing geometry preview', () => {
  it('replaces canonical local geometry while retaining the parent transform', () => {
    const presentation = {
      localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 50 }
    } as TextLayerEditingLayout;
    const projected = projectTextEditingGeometryPreview(
      presentation,
      { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
      { a: 0, b: 1, c: -1, d: 0, tx: 40, ty: 60 }
    );
    expect(projected.localToDocument).toEqual({
      a: 0, b: 2, c: -2, d: 0, tx: 90, ty: 130
    });
    expect(projected).not.toBe(presentation);
  });
});

describe('layer document asset loading', () => {
  it('invalidates a processing suffix cached before raster upload', async () => {
    const load = vi.fn(async () => {});
    const destroyCaches = vi.fn();
    const renderer = Object.create(LayerDocumentRenderer.prototype) as {
      runtime: {
        documentAssets: { load: typeof load };
        compositor: { destroyCaches: typeof destroyCaches };
      };
      loadDocumentAssets: LayerDocumentRenderer['loadDocumentAssets'];
    };
    renderer.runtime = {
      documentAssets: { load },
      compositor: { destroyCaches }
    };
    const assets = [{}] as Parameters<LayerDocumentRenderer['loadDocumentAssets']>[0];

    await renderer.loadDocumentAssets(assets);

    expect(load).toHaveBeenCalledWith(assets);
    expect(destroyCaches).toHaveBeenCalledOnce();
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      destroyCaches.mock.invocationCallOrder[0]
    );
  });
});
