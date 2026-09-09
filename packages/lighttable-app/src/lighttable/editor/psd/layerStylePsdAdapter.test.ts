import { describe, expect, it } from 'vitest';
import type { LayerEffectsInfo } from 'ag-psd';
import { importPsdLayerStyles } from './layerStylePsdAdapter';
import { convertEncodedDocumentColorToSrgb } from '../color/documentColorTransform';
import { MAX_LAYER_STYLE_MAGNITUDE } from '../styles/layerStyleValidation';

const px = (value: number) => ({ units: 'Pixels', value } as const);

describe('PSD Layer Style adapter', () => {
  it('normalizes extreme finite renderer scalars at the import boundary', () => {
    const result = importPsdLayerStyles({
      dropShadow: [{
        enabled: true, size: px(1e308), distance: px(1e308), angle: -1e308
      }]
    });
    expect(result.stack.effects[0]).toMatchObject({
      size: MAX_LAYER_STYLE_MAGNITUDE,
      distance: MAX_LAYER_STYLE_MAGNITUDE,
      angle: -MAX_LAYER_STYLE_MAGNITUDE
    });
  });

  it('normalizes non-finite scalars and structural collections into the canonical domain', () => {
    const excessiveCurve = Array.from({ length: 70 }, (_, index) => ({
      x: index / 69, y: index / 69
    }));
    const excessiveStops = Array.from({ length: 70 }, (_, index) => ({
      color: { r: index, g: index, b: index }, location: index / 69, midpoint: 50
    }));
    const excessiveOpacityStops = Array.from({ length: 70 }, (_, index) => ({
      opacity: 100, location: index / 69, midpoint: 50
    }));
    const result = importPsdLayerStyles({
      dropShadow: Array.from({ length: 65 }, (_, index) => ({
        enabled: true,
        size: px(index === 0 ? Number.NaN : index),
        distance: px(index === 0 ? Number.POSITIVE_INFINITY : index),
        contour: { name: 'bounded', curve: excessiveCurve }
      })),
      gradientOverlay: [{
        enabled: true,
        gradient: {
          type: 'solid', name: 'bounded', smoothness: 100,
          colorStops: excessiveStops,
          opacityStops: excessiveOpacityStops
        }
      }]
    });
    expect(result.stack.effects).toHaveLength(64);
    expect(result.stack.effects[0]).toMatchObject({ size: 30, distance: 30 });
    expect(result.stack.effects[0]?.kind === 'drop-shadow'
      ? result.stack.effects[0].contour.points : []).toHaveLength(64);
    expect(result.preservedDescriptors).toHaveLength(2);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      path: 'effects[64+]', support: 'preserved'
    }));

    const gradient = importPsdLayerStyles({ gradientOverlay: [{
      enabled: true,
      gradient: {
        type: 'solid', name: 'single', smoothness: 100,
        colorStops: excessiveStops.slice(0, 1),
        opacityStops: excessiveOpacityStops.slice(0, 1)
      }
    }] }).stack.effects[0];
    expect(gradient?.kind === 'gradient-overlay' ? gradient.gradient.colorStops : []).toHaveLength(2);
    expect(gradient?.kind === 'gradient-overlay' ? gradient.gradient.opacityStops : []).toHaveLength(2);

    const boundedGradient = importPsdLayerStyles({ gradientOverlay: [{
      enabled: true,
      gradient: {
        type: 'solid', name: 'bounded', smoothness: 100,
        colorStops: excessiveStops,
        opacityStops: excessiveOpacityStops
      }
    }] }).stack.effects[0];
    expect(boundedGradient?.kind === 'gradient-overlay'
      ? boundedGradient.gradient.colorStops : []).toHaveLength(64);
    expect(boundedGradient?.kind === 'gradient-overlay'
      ? boundedGradient.gradient.opacityStops : []).toHaveLength(64);
  });

  it('normalizes Adobe RGB FX colors and gradient stops into canonical sRGB semantics', () => {
    const result = importPsdLayerStyles({
      solidFill: [{ enabled: true, color: { r: 220, g: 40, b: 15 } }],
      gradientOverlay: [{
        enabled: true,
        gradient: {
          type: 'solid', name: 'Adobe fixture', smoothness: 100,
          colorStops: [{ color: { r: 20, g: 180, b: 240 }, location: 0, midpoint: 50 }],
          opacityStops: [{ opacity: 100, location: 0, midpoint: 50 }]
        }
      }]
    }, { sourceProfile: 'adobe-rgb-1998' });
    const solidExpected = convertEncodedDocumentColorToSrgb(
      { r: 220 / 255, g: 40 / 255, b: 15 / 255 }, 'adobe-rgb-1998'
    );
    const gradientExpected = convertEncodedDocumentColorToSrgb(
      { r: 20 / 255, g: 180 / 255, b: 240 / 255 }, 'adobe-rgb-1998'
    );
    expect(result.stack.effects[0]).toMatchObject({ color: solidExpected });
    const importedGradient = result.stack.effects[1];
    expect(importedGradient?.kind === 'gradient-overlay'
      ? importedGradient.gradient.colorStops[0]?.color : null).toMatchObject(gradientExpected);
  });

  it('imports ordered multiple-instance effects into editable canonical styles', () => {
    const source: LayerEffectsInfo = {
      scale: 100,
      dropShadow: [
        {
          enabled: true,
          opacity: 35,
          size: px(8),
          distance: px(5),
          angle: 120,
          blendMode: 'multiply',
          color: { r: 0, g: 0, b: 0 }
        },
        {
          enabled: true,
          opacity: 20,
          size: px(16),
          distance: px(2),
          angle: 90,
          blendMode: 'multiply',
          color: { r: 30, g: 20, b: 10 }
        }
      ],
      solidFill: [{
        enabled: true,
        opacity: 50,
        blendMode: 'normal',
        color: { r: 255, g: 64, b: 32 }
      }]
    };
    const result = importPsdLayerStyles(source);
    expect(result.stack.effects.map(({ kind }) => kind)).toEqual([
      'drop-shadow',
      'drop-shadow',
      'color-overlay'
    ]);
    expect(result.stack.effects[0].opacity).toBeCloseTo(0.35);
    expect(result.stack.effects[2].opacity).toBeCloseTo(0.5);
    expect(result.stack.scale).toBe(1);
    expect(result.compatibility[0]).toMatchObject({ support: 'editable' });
  });

  it('preserves unresolved patterns and resolves known document assets', () => {
    const source: LayerEffectsInfo = {
      patternOverlay: {
        enabled: true,
        pattern: { id: 'woven', name: 'Woven' },
        opacity: 100,
        scale: 125
      }
    };
    const unresolved = importPsdLayerStyles(source);
    expect(unresolved.preservedDescriptors).toHaveLength(1);
    expect(unresolved.compatibility).toContainEqual(expect.objectContaining({
      path: 'patternOverlay.pattern',
      support: 'preserved'
    }));
    const resolved = importPsdLayerStyles(source, {
      resolvePatternAsset: (id) => id === 'woven' ? 'asset-woven' : null
    });
    expect(resolved.preservedDescriptors).toHaveLength(0);
    expect(resolved.stack.effects[0]).toMatchObject({
      kind: 'pattern-overlay',
      pattern: { assetId: 'asset-woven' },
      scale: 1.25
    });
  });

  it('supports extended style blend modes while preserving unsupported noise gradients', () => {
    const source: LayerEffectsInfo = {
      gradientOverlay: [{
        enabled: true,
        blendMode: 'vivid light',
        gradient: {
          name: 'Noise',
          type: 'noise',
          roughness: 0.5,
          randomSeed: 7,
          min: [0, 0, 0, 0],
          max: [1, 1, 1, 1]
        }
      }]
    };
    const result = importPsdLayerStyles(source);
    expect(result.stack.effects[0]).toMatchObject({
      kind: 'gradient-overlay',
      enabled: false
    });
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      path: 'effects',
      support: 'editable'
    }));
    expect(result.compatibility.filter(({ support }) => support === 'rasterized')).toHaveLength(1);
    expect(result.preservedDescriptors).toHaveLength(1);
  });
});
