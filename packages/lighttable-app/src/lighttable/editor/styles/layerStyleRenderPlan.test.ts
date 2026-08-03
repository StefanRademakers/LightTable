import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyle, createDefaultLayerStyleStack } from './layerStyleDefaults';
import {
  layerStyleCacheKey,
  layerStyleDocumentBounds,
  layerStyleExpansion,
  layerSourceStyleCacheKey,
  layerSourceStyleDocumentBounds
} from './layerStyleRenderPlan';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createImageDocument, createTextLayerNode, type RasterLayer } from '../document/documentTypes';

const rasterLayer = (width: number, height: number) => {
  const document = createImageDocument('Fixture', width, height, 'asset');
  return document.layers[0] as RasterLayer;
};

describe('Layer Style render planning', () => {
  it('keeps disabled and interior-only styles inside the source bounds', () => {
    const stack = createDefaultLayerStyleStack();
    stack.effects = [createDefaultLayerStyle('inner-shadow')];
    expect(layerStyleExpansion(stack)).toBe(0);
    stack.enabled = false;
    stack.effects = [createDefaultLayerStyle('drop-shadow')];
    expect(layerStyleExpansion(stack)).toBe(0);
  });

  it('conservatively includes every outer effect and stack scaling', () => {
    const stack = createDefaultLayerStyleStack();
    stack.scale = 2;
    const shadow = createDefaultLayerStyle('drop-shadow');
    if (shadow.kind !== 'drop-shadow') throw new Error('Expected Drop Shadow.');
    shadow.distance = 7;
    shadow.size = 11;
    stack.effects = [shadow, createDefaultLayerStyle('outer-glow')];
    expect(layerStyleExpansion(stack)).toBe(36);
  });

  it('transforms, expands and clips style bounds to the document canvas', () => {
    const document = createImageDocument('Bounds', 200, 100, 'asset');
    const layer = rasterLayer(50, 20);
    layer.transform = { a: 1, b: 0, c: 0, d: 1, tx: 170, ty: 85 };
    layer.styleStack.effects = [createDefaultLayerStyle('outer-glow')];
    expect(layerStyleDocumentBounds(layer, document)).toEqual({
      x: 163,
      y: 78,
      width: 37,
      height: 22
    });
  });

  it('invalidates cached pixels for source, mask, style, geometry and quality changes', () => {
    const layer = rasterLayer(10, 10);
    const key = () => layerStyleCacheKey(layer, layer.transform, 'final');
    let previous = key();

    layer.pixelRevision += 1;
    expect(key()).not.toBe(previous);
    previous = key();

    layer.mask = {
      id: 'mask-a',
      enabled: true,
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    expect(key()).not.toBe(previous);
    previous = key();

    layer.mask.pixelRevision += 1;
    expect(key()).not.toBe(previous);
    previous = key();

    layer.geometryRevision += 1;
    expect(key()).not.toBe(previous);
    previous = key();

    layer.fillOpacity = 0.5;
    expect(key()).not.toBe(previous);
    previous = key();

    layer.styleStack.revision += 1;
    expect(key()).not.toBe(previous);
    previous = key();

    layer.transform = { ...layer.transform, tx: 2 };
    expect(key()).not.toBe(previous);
    expect(layerStyleCacheKey(layer, layer.transform, 'interactive')).not.toBe(key());
  });

  it('keeps composite-only opacity and blend changes outside the styled pixel cache', () => {
    const layer = rasterLayer(10, 10);
    const initial = layerStyleCacheKey(layer, layer.transform, 'final');
    layer.opacity = 0.25;
    layer.blendMode = 'multiply';
    expect(layerStyleCacheKey(layer, layer.transform, 'final')).toBe(initial);
  });

  it('uses tight text source dimensions and identity for style bounds and caching', () => {
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    layer.styleStack.effects = [createDefaultLayerStyle('outer-glow')];
    const source = {
      sourceKey: 'text-source-1',
      dimensions: { width: 40, height: 12 },
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 10 }
    };
    expect(layerSourceStyleDocumentBounds(layer, source, { width: 100, height: 80 })).toEqual({
      x: 13, y: 3, width: 54, height: 26
    });
    const key = layerSourceStyleCacheKey(layer, source, 'final');
    layer.opacity = 0.2;
    layer.blendMode = 'multiply';
    expect(layerSourceStyleCacheKey(layer, source, 'final')).toBe(key);
    expect(layerSourceStyleCacheKey(layer, { ...source, sourceKey: 'text-source-2' }, 'final')).not.toBe(key);
  });
});
