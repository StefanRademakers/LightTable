import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import type { PsdDecodeSuccess, PsdLayerNodeDto } from '../../image-io/psdProtocol';
import { importPsdDocument } from './psdDocumentAdapter';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';
import { translationMatrix } from '../tools/transform/affine';

const pixels = () => new Blob(['pixels'], { type: 'image/png' });

const raster = (
  id: string,
  overrides: Partial<PsdLayerNodeDto> = {}
): PsdLayerNodeDto => ({
  id,
  name: id,
  kind: 'raster',
  visible: true,
  opacity: 1,
  fillOpacity: 1,
  blendMode: 'normal',
  clipping: false,
  transparencyProtected: false,
  bounds: { left: 0, top: 0, right: 32, bottom: 24 },
  pixelSummary: {
    width: 32,
    height: 24,
    nonTransparentPixels: 768,
    maximumAlpha: 1
  },
  pixels: pixels(),
  rasterFallback: 'layer-preview',
  mask: null,
  effects: null,
  adjustment: null,
  preserved: {
    text: null,
    placedLayer: null,
    vectorFill: null,
    vectorMask: null,
    vectorStroke: null,
    realMask: null
  },
  children: [],
  ...overrides
});

const decoded = (layers: PsdLayerNodeDto[]): PsdDecodeSuccess => ({
  kind: 'decoded-psd',
  requestId: 1,
  preview: pixels(),
  width: 32,
  height: 24,
  bitsPerChannel: 8,
  colorMode: 'RGB',
  colorProfile: { disposition: 'untagged', name: null, normalizedToSrgb: true },
  inventory: {
    layers: 0,
    groups: 0,
    rasterPreviews: 0,
    masks: 0,
    layerStyles: 0,
    adjustments: 0,
    textLayers: 0,
    smartObjects: 0,
    vectorLayers: 0,
    maximumDepth: 0
  },
  layers,
  patterns: [],
  warnings: []
});

describe('importPsdDocument', () => {
  it('converts PSD content without embedding the complete source document', () => {
    const result = importPsdDocument(decoded([raster('background')]), 'fixture.psd');

    expect(result.document.assets.preservedSources).toEqual([]);
    expect(result.assets.some((asset) => 'sourceId' in asset)).toBe(false);
  });

  it('keeps raster previews layer-local and places them from Photoshop bounds', () => {
    const result = importPsdDocument(decoded([raster('local', {
      bounds: { left: 7, top: -3, right: 19, bottom: 5 },
      pixelSummary: {
        width: 12,
        height: 8,
        nonTransparentPixels: 64,
        maximumAlpha: 1
      }
    })]), 'local.psd');

    expect(result.document.layers[0]).toMatchObject({
      type: 'raster',
      width: 12,
      height: 8,
      transform: translationMatrix(7, -3)
    });
  });

  it('registers embedded Photoshop patterns and resolves Layer Style references', () => {
    const source = decoded([raster('patterned', {
      effects: {
        patternOverlay: {
          enabled: true,
          pattern: { id: 'woven', name: 'Woven' },
          opacity: 100,
          scale: 100
        }
      }
    })]);
    source.patterns = [{
      id: 'woven',
      name: 'Woven',
      width: 2,
      height: 2,
      pixels: pixels()
    }];

    const result = importPsdDocument(source, 'pattern.psd');

    expect(result.document.assets.patterns).toEqual([expect.objectContaining({
      id: 'psd-pattern-woven',
      name: 'Woven',
      width: 2,
      height: 2
    })]);
    expect(result.assets.some((asset) =>
      'patternId' in asset && asset.patternId === 'psd-pattern-woven'
    )).toBe(true);
    expect(result.document.layers[0].styleStack.effects[0]).toMatchObject({
      kind: 'pattern-overlay',
      pattern: { assetId: 'psd-pattern-woven' }
    });
  });

  it('preserves bottom-to-top order and nested group structure', () => {
    const child = raster('child');
    const group = raster('group', {
      kind: 'group',
      pixels: null,
      blendMode: 'pass through',
      children: [child]
    });
    const result = importPsdDocument(decoded([raster('bottom'), group, raster('top')]), 'test.psd');

    expect(result.document.layers.map(({ id }) => id)).toEqual(['bottom', 'group', 'top']);
    const importedGroup = result.document.layers[1];
    expect(importedGroup.type).toBe('group');
    if (importedGroup.type !== 'group') throw new Error('Expected a group');
    expect(importedGroup.compositing).toBe('pass-through');
    expect(importedGroup.children.map(({ id }) => id)).toEqual(['child']);
    expect(result.assets.map((asset) => 'layerId' in asset ? asset.layerId : null))
      .toEqual(['bottom', 'child', 'top']);
  });

  it('maps layer rendering state and mask assets', () => {
    const result = importPsdDocument(decoded([raster('masked', {
      opacity: 0.4,
      fillOpacity: 0.6,
      blendMode: 'multiply',
      clipping: true,
      transparencyProtected: true,
      mask: {
        id: 'masked-mask',
        pixels: pixels(),
        source: 'user-mask',
        enabled: true,
        defaultColor: 255,
        density: 0.75,
        feather: 3
      }
    })]), 'test.psd');
    const layer = result.document.layers[0];
    expect(layer).toMatchObject({
      opacity: 0.4,
      fillOpacity: 0.6,
      blendMode: 'multiply',
      clipping: true,
      locks: { transparency: true }
    });
    expect(layer.styleStack).toEqual(createDefaultLayerStyleStack());
    expect(layer.mask).toMatchObject({ density: 0.75, feather: 3 });
    expect(layer.photoshop).toMatchObject({
      sourceKind: 'raster',
      sourceBlendMode: 'multiply',
      bounds: { x: 0, y: 0, width: 32, height: 24 },
      mask: { defaultColor: 255, density: 0.75, feather: 3 }
    });
    expect(result.assets[0]).toMatchObject({ layerId: 'masked' });
    expect('mask' in result.assets[0] && result.assets[0].mask).toBeInstanceOf(Blob);
  });

  it('reports raster and vector mask operands independently', () => {
    const vectorMask = { paths: [], disable: false };
    const result = importPsdDocument(decoded([raster('combined-mask', {
      mask: {
        id: 'combined-mask-cache',
        pixels: pixels(),
        source: 'real-mask',
        enabled: true,
        defaultColor: 0,
        density: 0.8,
        feather: 2
      },
      preserved: {
        text: null,
        placedLayer: null,
        vectorFill: null,
        vectorMask,
        vectorStroke: null,
        realMask: { density: 0.8 }
      }
    })]), 'combined-mask.psd');

    const layer = result.document.layers[0];
    expect(layer.mask).toMatchObject({ density: 0.8, feather: 2 });
    expect(layer.photoshop?.preserved.vectorMask).toEqual(vectorMask);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'mask',
      support: 'preserved',
      reason: expect.stringContaining('separate operands')
    }));
    expect(result.warnings.join('\n')).toContain('combined raster cache is not editable vector authority');
  });

  it('maps extended Photoshop blend modes without silently falling back to Normal', () => {
    const modes = [
      ['linear-burn', 'linear burn'],
      ['darker-color', 'darker color'],
      ['lighter-color', 'lighter color'],
      ['vivid-light', 'vivid light'],
      ['linear-light', 'linear light'],
      ['pin-light', 'pin light'],
      ['hard-mix', 'hard mix'],
      ['exclusion', 'exclusion'],
      ['subtract', 'subtract'],
      ['divide', 'divide']
    ] as const;
    const result = importPsdDocument(decoded(
      modes.map(([_, source], index) => raster(`blend-${index}`, { blendMode: source }))
    ), 'blends.psd');
    expect(result.document.layers.map(({ blendMode }) => blendMode))
      .toEqual(modes.map(([mapped]) => mapped));
    expect(result.compatibility.filter(({ feature }) => feature === 'blend-mode'))
      .toHaveLength(modes.length);
    expect(result.warnings.join('\n')).not.toContain('renders as Normal');
  });

  it('keeps an unsupported semantic layer testable through its local raster preview', () => {
    const result = importPsdDocument(decoded([raster('smart', {
      kind: 'smart-object',
      preserved: {
        text: null,
        placedLayer: { id: 'placed' },
        vectorFill: null,
        vectorMask: null,
        vectorStroke: null,
        realMask: null
      }
    })]), 'test.psd');
    expect(result.document.layers[0]?.type).toBe('raster');
    expect(result.warnings.join('\n')).toContain('currently imports as its layer-local raster preview');
  });

  it('imports supported Photoshop vector shapes as editable native vector layers', () => {
    const result = importPsdDocument(decoded([raster('shape', {
      kind: 'vector',
      preserved: {
        text: null,
        placedLayer: null,
        vectorFill: { type: 'color', color: { r: 255, g: 0, b: 0 } },
        vectorMask: {
          paths: [{
            open: false,
            operation: 'combine',
            fillRule: 'non-zero',
            knots: [
              { linked: false, points: [1, 1, 1, 1, 1, 1] },
              { linked: false, points: [20, 1, 20, 1, 20, 1] },
              { linked: false, points: [20, 20, 20, 20, 20, 20] }
            ]
          }]
        },
        vectorStroke: null,
        realMask: null
      }
    })]), 'shape.psd');

    expect(result.document.layers[0]).toMatchObject({
      type: 'vector',
      antiAlias: true,
      elements: [expect.objectContaining({ type: 'path', name: 'shape' })]
    });
    expect(result.assets).toHaveLength(0);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      path: 'layers[0]',
      feature: 'node',
      support: 'native',
      reason: expect.stringContaining('editable LightTable vectors')
    }));
  });

  it('retains the Photoshop raster preview when vector semantics are unsupported', () => {
    const unsupportedPath = {
      open: false,
      operation: 'subtract',
      fillRule: 'non-zero',
      knots: [
        { linked: false, points: [1, 1, 1, 1, 1, 1] },
        { linked: false, points: [20, 1, 20, 1, 20, 1] },
        { linked: false, points: [20, 20, 20, 20, 20, 20] }
      ]
    };
    const result = importPsdDocument(decoded([raster('complex-shape', {
      kind: 'vector',
      preserved: {
        text: null,
        placedLayer: null,
        vectorFill: { type: 'color', color: { r: 255, g: 0, b: 0 } },
        vectorMask: { paths: [unsupportedPath] },
        vectorStroke: null,
        realMask: null
      }
    })]), 'complex-shape.psd');

    expect(result.document.layers[0]?.type).toBe('raster');
    expect(result.assets).toHaveLength(1);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      path: 'layers[0]',
      support: 'raster-preview',
      reason: expect.stringContaining('Subtract')
    }));
  });

  it('retains editable vector geometry beside a derived preview for unsupported paint', () => {
    const result = importPsdDocument(decoded([raster('gradient-shape', {
      kind: 'vector',
      preserved: {
        text: null,
        placedLayer: null,
        vectorFill: { type: 'solid', gradient: { name: 'Source gradient' } },
        vectorMask: { paths: [{
          open: false, operation: 'combine', fillRule: 'non-zero',
          knots: [
            { linked: false, points: [1, 1, 1, 1, 1, 1] },
            { linked: false, points: [20, 1, 20, 1, 20, 1] },
            { linked: false, points: [20, 20, 20, 20, 20, 20] }
          ]
        }] },
        vectorStroke: null,
        realMask: null
      }
    })]), 'gradient-shape.psd');

    expect(result.document.layers[0]).toMatchObject({
      type: 'vector',
      elements: [expect.objectContaining({
        type: 'path', style: expect.objectContaining({ fill: null })
      })],
      derivedPreview: expect.objectContaining({ source: 'photoshop-layer-preview' })
    });
    expect(result.assets).toEqual([expect.objectContaining({ layerId: result.document.layers[0]?.id })]);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      path: 'layers[0]', support: 'approximate', editable: true,
      parity: expect.objectContaining({ visual: 'raster-preview', semantic: 'editable' })
    }));
  });

  it('imports supported Photoshop text without a usable preview as editable flow text', () => {
    const result = importPsdDocument(decoded([raster('text', {
      kind: 'text',
      rasterFallback: 'transparent-placeholder',
      preserved: {
        text: {
          text: 'Editable now', shapeType: 'box', boxBounds: [2, 3, 30, 20],
          style: { font: { name: 'Inter' }, fontSize: 18 }
        },
        placedLayer: null,
        vectorFill: null,
        vectorMask: null,
        vectorStroke: null,
        realMask: null
      }
    })]), 'text.psd');
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.layers[0]).toMatchObject({
      type: 'text',
      photoshop: { sourceKind: 'text' },
      text: {
        source: {
          kind: 'flow', text: 'Editable now',
          layout: { mode: 'paragraph', frame: { x: 2, y: 3, width: 28, height: 17 } }
        },
        interchange: { format: 'psd', sourceObjectId: 'text' }
      }
    });
    expect(result.assets).toHaveLength(0);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'text', support: 'approximate', layerId: 'text', editable: true,
      parity: {
        visual: 'approximate', semantic: 'editable',
        structural: 'native', roundTrip: 'unsupported'
      }
    }));
    expect(result.warnings.join('\n')).toContain('exact appearance depends');
  });

  it('places recovered Photoshop path geometry below its editable text layer', () => {
    const result = importPsdDocument(decoded([raster('path-text', {
      kind: 'text',
      rasterFallback: 'transparent-placeholder',
      preserved: {
        text: {
          text: 'Curve', transform: [1, 0, 0, 1, 10, 20],
          textPath: {
            bezierCurve: { controlPoints: [10, 20, 20, 20, 30, 30, 40, 40] },
            data: { frameMatrix: [1, 0, 0, 1, -10, -20], textRange: [0, 1] }
          }
        },
        placedLayer: null, vectorFill: null, vectorMask: null,
        vectorStroke: null, realMask: null
      }
    })]), 'path-text.psd');

    expect(result.document.layers).toHaveLength(2);
    expect(result.document.layers[0]).toMatchObject({
      id: 'path-text-text-path', type: 'vector', visible: false,
      elements: [{ id: 'path-text-text-path-element', type: 'path' }]
    });
    expect(result.document.layers[1]).toMatchObject({
      id: 'path-text', type: 'text',
      text: { source: { layout: {
        mode: 'path', pathLayerId: 'path-text-text-path',
        pathElementId: 'path-text-text-path-element',
        pathSubpathId: 'path-text-text-path-subpath'
      } } }
    });
  });

  it('prefers editable semantic text while retaining the Photoshop composite as reference', () => {
    const result = importPsdDocument(decoded([raster('preview-text', {
      kind: 'text',
      preserved: {
        text: {
          text: 'Preview first',
          style: { font: { name: 'Unknown Font' }, fillColor: { r: 255, g: 0, b: 0 } },
          styleRuns: [
            { length: 8, style: { fillColor: { r: 255, g: 0, b: 0 } } },
            { length: 5, style: { fillColor: { r: 0, g: 255, b: 0 } } }
          ]
        },
        placedLayer: null, vectorFill: null, vectorMask: null, vectorStroke: null, realMask: null
      }
    })]), 'preview-text.psd');
    expect(result.document.layers[0]).toMatchObject({
      type: 'text',
      derivedPreview: {
        width: 32,
        height: 24,
        transform: translationMatrix(0, 0),
        dependencyKey: 'text:0:0:0:0:0:0',
        source: 'photoshop-layer-preview'
      },
      text: {
        source: {
          kind: 'flow',
          text: 'Preview first',
          styleRuns: [
            { start: 0, end: 8, fill: { color: { r: 1, g: 0, b: 0 } } },
            { start: 8, end: 13, fill: { color: { r: 0, g: 1, b: 0 } } }
          ]
        }
      }
    });
    expect(result.assets).toEqual([{ layerId: 'preview-text', pixels: expect.any(Blob), mask: null }]);
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'text', support: 'approximate',
      layerId: 'preview-text', editable: true,
      parity: {
        visual: 'approximate', semantic: 'editable',
        structural: 'native', roundTrip: 'unsupported'
      }
    }));
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'node',
      reason: expect.stringContaining('retained Photoshop composite')
    }));
  });

  it('creates ordered native adjustment nodes for Photoshop settings already expressible by LightTable', () => {
    const result = importPsdDocument(decoded([raster('exposure', {
      kind: 'adjustment',
      pixels: null,
      adjustment: { type: 'exposure', exposure: 1.25, offset: 0, gamma: 1 }
    })]), 'test.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    expect(layer.adjustmentKind).toBe('exposure');
    expect(materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment)
      .toMatchObject({ kind: 'exposure', exposure: 1.25, exposureOffset: 0, exposureGamma: 1 });
    expect(result.assets).toHaveLength(0);
  });

  it('maps Photoshop Levels to the channel-aware native Levels node', () => {
    const result = importPsdDocument(decoded([raster('levels', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'levels',
        rgb: {
          shadowInput: 16,
          highlightInput: 235,
          shadowOutput: 8,
          highlightOutput: 246,
          midtoneInput: 1.3
        },
        red: {
          shadowInput: 12,
          highlightInput: 240,
          shadowOutput: 4,
          highlightOutput: 248,
          midtoneInput: 0.8
        }
      }
    })]), 'levels.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    const settings = materializeBasicAdjustments(layer.adjustmentStack);
    expect(layer.adjustmentKind).toBe('levels');
    expect(settings.photoshopAdjustment).toMatchObject({
      kind: 'levels', levelsChannel: 'rgb',
      levels: {
        rgb: { input: [16, 1.3, 235], output: [8, 246] },
        red: { input: [12, 0.8, 240], output: [4, 248] }
      }
    });
  });

  it('maps Photoshop Curves to its natural-spline rendering mode', () => {
    const result = importPsdDocument(decoded([raster('curves', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'curves',
        rgb: [
          { input: 0, output: 0 },
          { input: 128, output: 230 },
          { input: 255, output: 255 }
        ]
      }
    })]), 'curves.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    expect(materializeBasicAdjustments(layer.adjustmentStack).curves).toMatchObject({
      interpolation: 'photoshop-natural',
      master: [{ x: 0, y: 0 }, { x: 128 / 255, y: 230 / 255 }, { x: 1, y: 1 }]
    });
  });

  it('maps Photoshop Invert to its dedicated native node', () => {
    const result = importPsdDocument(decoded([raster('invert', {
      kind: 'adjustment',
      pixels: null,
      adjustment: { type: 'invert' }
    })]), 'invert.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    expect(layer.adjustmentKind).toBe('invert');
    expect(materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment.kind)
      .toBe('invert');
  });

  it('maps a solid Photoshop Gradient Map to the native ordered gradient executor', () => {
    const result = importPsdDocument(decoded([raster('gradient-map', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'gradient map',
        gradientType: 'solid',
        reverse: true,
        dither: true,
        colorStops: [
          { location: 0, midpoint: 40, color: { r: 10, g: 20, b: 30 } },
          { location: 4096, midpoint: 50, color: { r: 240, g: 230, b: 220 } }
        ],
        opacityStops: [
          { location: 0, midpoint: 50, opacity: 100 },
          { location: 4096, midpoint: 50, opacity: 100 }
        ]
      }
    })]), 'gradient-map.psd');
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');

    expect(materializeBasicAdjustments(layer.adjustmentStack).gradientMap).toMatchObject({
      enabled: true,
      reverse: true,
      dither: true,
      colorStops: [
        { position: 0, midpoint: 0.4 },
        { position: 1, midpoint: 0.5 }
      ]
    });
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'adjustment', support: 'native'
    }));
  });

  it.each([
    ['brightness-contrast', { type: 'brightness/contrast', brightness: 12, contrast: 8 }],
    ['exposure', { type: 'exposure', exposure: 1, offset: 0.01, gamma: 1.1 }],
    ['hue-saturation', { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: 5, saturation: 6, lightness: 7 } }],
    ['color-balance', { type: 'color balance', shadows: { cyanRed: 1, magentaGreen: 2, yellowBlue: 3 } }],
    ['black-white', { type: 'black & white', reds: 41, yellows: 59 }],
    ['photo-filter', { type: 'photo filter', color: { r: 255, g: 128, b: 0 }, density: 24 }],
    ['channel-mixer', { type: 'channel mixer', red: { red: 100, green: 0, blue: 0, constant: 0 } }],
    ['color-lookup', { type: 'color lookup', lut3DFileName: 'LightTable-moonlight.cube', lut3DFileData: new Uint8Array([1]) }],
    ['selective-color', { type: 'selective color', mode: 'relative', reds: { c: 1, m: 2, y: 3, k: 4 } }],
    ['posterize', { type: 'posterize', levels: 6 }],
    ['threshold', { type: 'threshold', level: 110 }]
  ] as const)('restores Photoshop %s as its dedicated contextual adjustment node', (kind, adjustment) => {
    const result = importPsdDocument(decoded([raster(kind, {
      kind: 'adjustment', pixels: null, adjustment
    })]), `${kind}.psd`);
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer.');

    expect(layer.adjustmentKind).toBe(kind);
    expect(materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment.kind)
      .toBe(kind);
  });

  it('restores normalized Lab colors and fractional density from Photoshop Photo Filter', () => {
    const result = importPsdDocument(decoded([raster('photo-filter-lab', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'photo filter',
        color: { l: 0.703, a: 0.3162992125984252, b: 0.5348818897637795 },
        density: 0.8,
        preserveLuminosity: false
      }
    })]), 'photo-filter-lab.psd');
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer.');
    const settings = materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment;

    expect(settings.kind).toBe('photo-filter');
    expect(settings.photoFilterDensity).toBe(80);
    expect(settings.preserveLuminosity).toBe(false);
    expect(settings.photoFilterColor.r).toBeCloseTo(1, 2);
    expect(settings.photoFilterColor.g).toBeCloseTo(140 / 255, 2);
    expect(settings.photoFilterColor.b).toBeCloseTo(40 / 255, 2);
  });

  it('restores Photoshop Hue/Saturation Colorize parameters', () => {
    const result = importPsdDocument(decoded([raster('colorize', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'hue/saturation',
        master: { a: 256, b: -72, c: 80, d: -12, hue: 0, saturation: 0, lightness: 0 }
      }
    })]), 'colorize.psd');
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer.');
    expect(materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment).toMatchObject({
      kind: 'hue-saturation', colorize: true, hue: 288, hueSaturation: 80, hueLightness: -12
    });
  });

  it('restores editable Photoshop Hue/Saturation color ranges and falloff boundaries', () => {
    const result = importPsdDocument(decoded([raster('red-range', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'hue/saturation',
        master: { a: 0, b: -144, c: 25, d: 0, hue: 0, saturation: 0, lightness: 0 },
        reds: { a: 300, b: 330, c: 20, d: 50, hue: 40, saturation: -60, lightness: 80 }
      }
    })]), 'red-range.psd');
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer.');
    expect(materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment).toMatchObject({
      hueSaturationChannel: 'reds',
      hueSaturationRanges: {
        reds: { boundaries: [300, 330, 20, 50], hue: 40, saturation: -60, lightness: 80 }
      }
    });
    expect(result.compatibility).toContainEqual(expect.objectContaining({
      feature: 'adjustment', support: 'native'
    }));
  });

  it('restores an embedded Photoshop .cube LUT as a document asset', async () => {
    const sourceText = [
      'TITLE "Imported Cinematic"',
      'LUT_3D_SIZE 2',
      '0 0 0', '1 0 0', '0 1 0', '1 1 0',
      '0 0 1', '1 0 1', '0 1 1', '1 1 1', ''
    ].join('\n');
    const sourceBytes = new TextEncoder().encode(sourceText);
    const result = importPsdDocument(decoded([raster('custom-lookup', {
      kind: 'adjustment',
      pixels: null,
      adjustment: {
        type: 'color lookup',
        lutFormat: 'cube',
        lut3DFileName: 'Imported.cube',
        lut3DFileData: sourceBytes
      }
    })]), 'custom-lookup.psd');
    const layer = result.document.layers[0];
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer.');
    const settings = materializeBasicAdjustments(layer.adjustmentStack).photoshopAdjustment;
    const metadata = result.document.assets.colorLookups[0];
    const binary = result.assets.find((asset) => 'lutId' in asset);

    expect(metadata).toMatchObject({
      id: settings.colorLookupAssetId,
      name: 'Imported Cinematic',
      size: 2,
      byteLength: sourceBytes.byteLength
    });
    expect(binary && 'lutId' in binary ? binary.lutId : null).toBe(metadata?.id);
    expect(binary && 'lutId' in binary
      ? new Uint8Array(await binary.source.arrayBuffer())
      : null).toEqual(sourceBytes);
  });

  it('folds simple clipped Photoshop adjustment layers into ordered attached nodes', () => {
    const result = importPsdDocument(decoded([
      raster('pixels'),
      raster('attached-levels', {
        kind: 'adjustment', pixels: null, clipping: true,
        adjustment: {
          type: 'levels',
          rgb: {
            shadowInput: 9, midtoneInput: 1.15, highlightInput: 241,
            shadowOutput: 2, highlightOutput: 252
          }
        }
      }),
      raster('attached-invert', {
        kind: 'adjustment', pixels: null, clipping: true,
        adjustment: { type: 'invert' }
      })
    ]), 'attached.psd');

    expect(result.document.layers).toHaveLength(1);
    const layer = result.document.layers[0];
    if (layer.type !== 'raster') throw new Error('Expected raster base.');
    expect(layer.attachedAdjustments?.map(({ adjustmentKind, name }) => ({
      adjustmentKind, name
    }))).toEqual([
      { adjustmentKind: 'levels', name: 'attached-levels' },
      { adjustmentKind: 'invert', name: 'attached-invert' }
    ]);
    expect(materializeBasicAdjustments(
      layer.attachedAdjustments![0]!.adjustmentStack
    ).photoshopAdjustment.levels.rgb.input).toEqual([9, 1.15, 241]);
  });
});
