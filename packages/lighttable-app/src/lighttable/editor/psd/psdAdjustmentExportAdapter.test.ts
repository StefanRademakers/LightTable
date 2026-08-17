import { readPsd, writePsdUint8Array, type AdjustmentLayer as PsdAdjustment } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import {
  adjustmentLayerDefinition,
  selectAdjustmentLayerModules,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import type { PhotoshopAdjustmentKind } from '../../photoshopAdjustments';
import { exportAdjustmentStackToPsd } from './psdAdjustmentExportAdapter';

const binaryRoundTrip = (adjustment: PsdAdjustment) => {
  const bytes = writePsdUint8Array({
    width: 1,
    height: 1,
    imageData: { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) },
    children: [{ name: 'Adjustment', adjustment }]
  }, { noBackground: true, trimImageData: true });
  return readPsd(bytes, {
    useImageData: true,
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  }).children?.[0]?.adjustment;
};

const authored = (kind: PhotoshopAdjustmentKind) => {
  const values = createDefaultAdjustments();
  values.photoshopAdjustment = {
    ...values.photoshopAdjustment,
    kind,
    brightness: 24,
    contrast: 13,
    levels: {
      ...values.photoshopAdjustment.levels,
      rgb: { input: [12, 1.25, 238], output: [4, 249] }
    },
    exposure: 1.5,
    exposureOffset: 0.02,
    exposureGamma: 1.1,
    vibrance: 80,
    vibranceSaturation: -20,
    hue: 18,
    hueSaturation: 22,
    hueLightness: -4,
    posterizeLevels: 7,
    thresholdLevel: 116,
    colorLookupPreset: 'teal-orange'
  };
  const stack = selectAdjustmentLayerModules(
    createAdjustmentStackFromBasicAdjustments(values),
    kind as AdjustmentLayerKind
  );
  return exportAdjustmentStackToPsd(kind, stack)!;
};

describe('Photoshop adjustment export adapter', () => {
  it.each([
    ['brightness-contrast', 'brightness/contrast'],
    ['levels', 'levels'],
    ['exposure', 'exposure'],
    ['vibrance', 'vibrance'],
    ['hue-saturation', 'hue/saturation'],
    ['color-balance', 'color balance'],
    ['black-white', 'black & white'],
    ['photo-filter', 'photo filter'],
    ['channel-mixer', 'channel mixer'],
    ['color-lookup', 'color lookup'],
    ['selective-color', 'selective color'],
    ['invert', 'invert'],
    ['posterize', 'posterize'],
    ['threshold', 'threshold']
  ] as const)('writes %s as a native, binary-roundtrippable %s descriptor', (kind, type) => {
    const decoded = binaryRoundTrip(authored(kind));
    expect(decoded?.type).toBe(type);
  });

  it('retains authored parameter values instead of exporting neutral placeholders', () => {
    expect(binaryRoundTrip(authored('levels'))).toMatchObject({
      type: 'levels',
      rgb: {
        shadowInput: 12, midtoneInput: 1.25, highlightInput: 238,
        shadowOutput: 4, highlightOutput: 249
      }
    });
    const exposure = binaryRoundTrip(authored('exposure'));
    expect(exposure).toMatchObject({ type: 'exposure', exposure: 1.5 });
    if (exposure?.type !== 'exposure') throw new Error('Expected Exposure descriptor.');
    expect(exposure.offset).toBeCloseTo(0.02, 6);
    expect(exposure.gamma).toBeCloseTo(1.1, 6);
    expect(binaryRoundTrip(authored('vibrance'))).toMatchObject({
      type: 'vibrance', vibrance: 80, saturation: -20
    });
    expect(binaryRoundTrip(authored('color-lookup'))).toMatchObject({
      type: 'color lookup', lutFormat: 'cube', lut3DFileName: 'LightTable-teal-orange.cube'
    });
    expect(binaryRoundTrip(authored('photo-filter'))).toMatchObject({
      type: 'photo filter', density: 0.25
    });
  });

  it('roundtrips Photoshop Colorize using its native Hue/Saturation descriptor encoding', () => {
    const values = createDefaultAdjustments();
    values.photoshopAdjustment = {
      ...values.photoshopAdjustment,
      kind: 'hue-saturation',
      colorize: true,
      hue: 288,
      hueSaturation: 80,
      hueLightness: -12
    };
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(values),
      'hue-saturation'
    );
    expect(binaryRoundTrip(exportAdjustmentStackToPsd('hue-saturation', stack)!)).toMatchObject({
      type: 'hue/saturation',
      master: { a: 256, b: -72, c: 80, d: -12, hue: 0, saturation: 0, lightness: 0 }
    });
  });

  it('roundtrips Photoshop Hue/Saturation color ranges and falloff boundaries', () => {
    const values = createDefaultAdjustments();
    values.photoshopAdjustment.kind = 'hue-saturation';
    values.photoshopAdjustment.hueSaturationRanges.reds = {
      boundaries: [300, 330, 20, 50], hue: 40, saturation: -60, lightness: 80
    };
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(values),
      'hue-saturation'
    );
    expect(binaryRoundTrip(exportAdjustmentStackToPsd('hue-saturation', stack)!)).toMatchObject({
      type: 'hue/saturation',
      reds: { a: 300, b: 330, c: 20, d: 50, hue: 40, saturation: -60, lightness: 80 }
    });
  });

  it('roundtrips composite and per-channel Levels together', () => {
    const values = createDefaultAdjustments();
    values.photoshopAdjustment.kind = 'levels';
    values.photoshopAdjustment.levels.rgb = {
      input: [20, 0.5, 235], output: [10, 245]
    };
    values.photoshopAdjustment.levels.red = {
      input: [30, 2, 220], output: [20, 235]
    };
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(values), 'levels'
    );
    expect(binaryRoundTrip(exportAdjustmentStackToPsd('levels', stack)!)).toMatchObject({
      type: 'levels',
      rgb: {
        shadowInput: 20, midtoneInput: 0.5, highlightInput: 235,
        shadowOutput: 10, highlightOutput: 245
      },
      red: {
        shadowInput: 30, midtoneInput: 2, highlightInput: 220,
        shadowOutput: 20, highlightOutput: 235
      }
    });
  });

  it('embeds the exact source bytes for a document Color Lookup asset', () => {
    const values = createDefaultAdjustments();
    values.photoshopAdjustment = {
      ...values.photoshopAdjustment,
      kind: 'color-lookup',
      colorLookupPreset: 'none',
      colorLookupAssetId: 'lut-cinematic'
    };
    const stack = selectAdjustmentLayerModules(
      createAdjustmentStackFromBasicAdjustments(values),
      'color-lookup'
    );
    const source = new TextEncoder().encode([
      'LUT_3D_SIZE 2',
      '0 0 0', '1 0 0', '0 1 0', '1 1 0',
      '0 0 1', '1 0 1', '0 1 1', '1 1 1', ''
    ].join('\n'));
    const descriptor = exportAdjustmentStackToPsd('color-lookup', stack, (assetId) => (
      assetId === 'lut-cinematic' ? { name: 'Cinematic.cube', data: source } : null
    ));
    const decoded = binaryRoundTrip(descriptor!);

    expect(decoded).toMatchObject({
      type: 'color lookup',
      lutFormat: 'cube',
      dataOrder: 'rgb',
      tableOrder: 'bgr',
      lut3DFileName: 'Cinematic.cube'
    });
    if (decoded?.type !== 'color lookup') throw new Error('Expected Color Lookup descriptor.');
    expect(Array.from(decoded.lut3DFileData ?? [])).toEqual(Array.from(source));
    expect(new TextDecoder().decode(decoded.profile?.slice(12, 24))).toBe('linkRGB RGB ');
  });

  it('keeps the existing Curves, Gradient Map and Vibrance native paths', () => {
    for (const kind of ['curves', 'gradient-map', 'color-vibrance'] as const) {
      const values = createDefaultAdjustments();
      if (kind === 'gradient-map' && values.gradientMap) values.gradientMap.enabled = true;
      const stack = selectAdjustmentLayerModules(
        createAdjustmentStackFromBasicAdjustments(values), kind
      );
      const descriptor = exportAdjustmentStackToPsd(kind, stack);
      expect(binaryRoundTrip(descriptor!)?.type).toBe(
        kind === 'gradient-map' ? 'gradient map' : kind === 'curves' ? 'curves' : 'vibrance'
      );
    }
  });

  it('does not mislabel Grade or Lens Fx as a neutral Photoshop adjustment', () => {
    const values = createDefaultAdjustments();
    for (const kind of ['grade', 'lens-fx'] as const) {
      const stack = selectAdjustmentLayerModules(
        createAdjustmentStackFromBasicAdjustments(values), kind
      );
      expect(exportAdjustmentStackToPsd(kind, stack)).toBeNull();
      expect(adjustmentLayerDefinition(kind).family).toBe('lighttable');
    }
  });
});
