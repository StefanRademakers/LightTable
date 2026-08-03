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
      reason: expect.stringContaining('editable LightTable vector paths')
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
    expect(materializeBasicAdjustments(layer.adjustmentStack).exposureEV).toBe(1.25);
    expect(result.assets).toHaveLength(0);
  });

  it('maps Photoshop Levels to editable LightTable curve channels', () => {
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
        }
      }
    })]), 'levels.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    const settings = materializeBasicAdjustments(layer.adjustmentStack);
    expect(settings.curves.master).toHaveLength(33);
    expect(settings.curves.master[0]?.y).toBeCloseTo(8 / 255);
    expect(settings.curves.master.at(-1)?.y).toBeCloseTo(246 / 255);
  });

  it('maps Photoshop Invert to an exact editable master curve', () => {
    const result = importPsdDocument(decoded([raster('invert', {
      kind: 'adjustment',
      pixels: null,
      adjustment: { type: 'invert' }
    })]), 'invert.psd');
    const layer = result.document.layers[0];
    expect(layer.type).toBe('adjustment');
    if (layer.type !== 'adjustment') throw new Error('Expected an adjustment layer');
    expect(materializeBasicAdjustments(layer.adjustmentStack).curves.master).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0 }
    ]);
  });
});
