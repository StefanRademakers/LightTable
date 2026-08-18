import { describe, expect, it } from 'vitest';
import {
  parseLightTableRecipe,
  resolveLightTableEditorSourceKey,
  resolveLightTableSaveSourceKey
} from './lightTableRecipe';
import { createDefaultAdjustments } from './types';

describe('parseLightTableRecipe', () => {
  it('retains the embedded layered document marker', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'media/layered.lighttable.png',
        documentFormat: 'embedded-layered-png',
        settings: { exposureEV: 1 }
      }
    });
    expect(recipe?.documentFormat).toBe('embedded-layered-png');
  });

  it('restores and clamps the separate Global Grade strength', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'media/graded.png',
        globalGradeStrength: 62,
        settings: { exposureEV: 1 }
      }
    });
    expect(recipe?.globalGradeStrength).toBe(62);
  });

  it('restores recognized settings and fills current defaults', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          exposureEV: 1.25,
          effects: { grain: { enabled: true, amount: 0.4 } }
        }
      }
    });

    expect(recipe?.sourceFileKey).toBe('projects/project-1/media/original.png');
    expect(recipe?.settings.exposureEV).toBe(1.25);
    expect(recipe?.settings.effects.grain.enabled).toBe(true);
    expect(recipe?.settings.effects.grain.amount).toBe(0.4);
    expect(recipe?.settings.temperature).toBe(0);
    expect(recipe?.settings.colorMixer.hue).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(recipe?.settings.colorGrading.blending).toBe(50);
    expect(recipe?.settings.curves.master).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('restores nested Color Grading wheels and range controls', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          colorGrading: {
            hue: [215, 225, 35, 48],
            saturation: [5, 24, 8, 31],
            luminance: [0, -12, 4, 9],
            blending: 62,
            balance: 18
          }
        }
      }
    });

    expect(recipe?.settings.colorGrading.hue).toEqual([215, 225, 35, 48]);
    expect(recipe?.settings.colorGrading.saturation[1]).toBe(24);
    expect(recipe?.settings.colorGrading.luminance[3]).toBe(9);
    expect(recipe?.settings.colorGrading.blending).toBe(62);
    expect(recipe?.settings.colorGrading.balance).toBe(18);
  });

  it('restores and clamps a native Grade Look independently from Color Lookup', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'media/look.png',
        settings: {
          gradeLook: { assetId: 'lut-cinema', strength: 125 }
        }
      }
    });

    expect(recipe?.settings.gradeLook).toEqual({ assetId: 'lut-cinema', strength: 100 });
    expect(recipe?.settings.photoshopAdjustment.colorLookupAssetId).toBeNull();
  });

  it('restores opt-in Halation settings', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          effects: { halation: { enabled: true, amount: 48, radius: 60, threshold: 80, warmth: 66 } }
        }
      }
    });
    expect(recipe?.settings.effects.halation.enabled).toBe(true);
    expect(recipe?.settings.effects.halation.radius).toBe(60);
  });

  it('restores Chromatic Aberration optics settings', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          effects: { chromaticAberration: { enabled: true, amount: 22, falloff: 81, balance: -14 } }
        }
      }
    });
    expect(recipe?.settings.effects.chromaticAberration.enabled).toBe(true);
    expect(recipe?.settings.effects.chromaticAberration.balance).toBe(-14);
  });

  it('restores Lens Distortion optics settings', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          effects: { lensDistortion: { enabled: true, amount: -31, midpoint: 62, zoom: 8 } }
        }
      }
    });
    expect(recipe?.settings.effects.lensDistortion.enabled).toBe(true);
    expect(recipe?.settings.effects.lensDistortion.amount).toBe(-31);
    expect(recipe?.settings.effects.lensDistortion.midpoint).toBe(62);
  });

  it('restores Lens Blur settings including its aperture shape', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          effects: {
            lensBlur: {
              enabled: true,
              apertureSize: 61,
              bokehShape: 'anamorphic',
              quality: 'ultra',
              focusDistance: 0.4,
              depthOfField: 0.18
            }
          }
        }
      }
    });
    expect(recipe?.settings.effects.lensBlur.enabled).toBe(true);
    expect(recipe?.settings.effects.lensBlur.bokehShape).toBe('anamorphic');
    expect(recipe?.settings.effects.lensBlur.quality).toBe('ultra');
    expect(recipe?.settings.effects.lensBlur.focusDistance).toBe(0.4);
  });

  it('restores the document-output Post-crop Vignette controls', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          effects: {
            vignette: {
              enabled: true,
              amount: -64,
              midpoint: 37,
              roundness: 22,
              feather: 73,
              highlights: 48
            }
          }
        }
      }
    });

    expect(recipe?.settings.effects.vignette).toEqual({
      enabled: true,
      amount: -64,
      midpoint: 37,
      roundness: 22,
      feather: 73,
      highlights: 48
    });
  });

  it('restores nested Color Mixer channels', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          colorMixer: {
            hue: [10, 0, 0, 0, 0, 0, 0, -10],
            saturation: [0, 20, 0, 0, 0, 0, 0, 0],
            luminance: [0, 0, -15, 0, 0, 0, 0, 0]
          }
        }
      }
    });

    expect(recipe?.settings.colorMixer.hue[0]).toBe(10);
    expect(recipe?.settings.colorMixer.saturation[1]).toBe(20);
    expect(recipe?.settings.colorMixer.luminance[2]).toBe(-15);
  });

  it('restores current Point Color samples', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'test',
        settings: {
          pointColor: { samples: [{
            id: 'skin', lightness: 0.7, chroma: 0.12, hue: 0.8,
            hueShift: 12, saturationShift: -8, luminanceShift: 5, variance: 20,
            range: 60, hueRange: 30, saturationRange: 40, luminanceRange: 50
          }] }
        }
      }
    });
    expect(recipe?.settings.pointColor.samples[0]).toMatchObject({
      id: 'skin', hueShift: 12, range: 60
    });
  });

  it('restores the native eight-range Black & White Mix', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'black-white.lighttable.png',
        settings: {
          blackWhiteMix: {
            enabled: true,
            luminance: [-20, 35, 10, -5, 18, -40, 12, 8]
          }
        }
      }
    });

    expect(recipe?.settings.blackWhiteMix.enabled).toBe(true);
    expect(recipe?.settings.blackWhiteMix.luminance)
      .toEqual([-20, 35, 10, -5, 18, -40, 12, 8]);
  });

  it('restores Custom Curve control points', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: {
          curves: {
            master: [{ x: 0, y: 0.12 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }],
            red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            blue: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }]
          }
        }
      }
    });
    expect(recipe?.settings.curves.master[0].y).toBe(0.12);
    expect(recipe?.settings.curves.blue[1].y).toBe(0.9);
  });

  it('restores a structured Gradient Map without flattening its stops', () => {
    const gradientMap = {
      enabled: true,
      reverse: true,
      dither: false,
      colorStops: [
        { position: 0, midpoint: 0.35, color: { r: 0.1, g: 0.2, b: 0.3 } },
        { position: 1, midpoint: 0.65, color: { r: 0.8, g: 0.7, b: 0.6 } }
      ],
      opacityStops: [
        { position: 0, midpoint: 0.5, opacity: 0.2 },
        { position: 1, midpoint: 0.5, opacity: 1 }
      ]
    };
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'gradient-map.psd',
        settings: { gradientMap }
      }
    });

    expect(recipe?.settings.gradientMap).toEqual(gradientMap);
  });

  it('restores current Detail settings', () => {
    const recipe = parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'detail.png',
        settings: {
          detail: { sharpeningAmount: 85, colorNoiseReduction: 42 }
        }
      }
    });
    expect(recipe?.settings.detail.sharpeningAmount).toBe(85);
    expect(recipe?.settings.detail.colorNoiseReduction).toBe(42);
    expect(recipe?.settings.detail.luminanceDetail).toBe(50);
  });

  it('rejects incomplete and non-numeric recipes', () => {
    expect(parseLightTableRecipe({ lighttable: { settings: { exposureEV: 1 } } })).toBeNull();
    expect(parseLightTableRecipe({
      lighttable: {
        sourceFileKey: 'projects/project-1/media/original.png',
        settings: { exposureEV: 'high' }
      }
    })).toBeNull();
  });
});

describe('resolveLightTableEditorSourceKey', () => {
  it('reopens the original source for a flat correction', () => {
    expect(resolveLightTableEditorSourceKey('corrected.png', {
      sourceFileKey: 'original.png',
      settings: createDefaultAdjustments()
    })).toBe('original.png');
  });

  it('reopens the selected container for a layered document', () => {
    expect(resolveLightTableEditorSourceKey('layered.lighttable.png', {
      sourceFileKey: 'original.png',
      settings: createDefaultAdjustments(),
      documentFormat: 'embedded-layered-png'
    })).toBe('layered.lighttable.png');
  });
});

describe('resolveLightTableSaveSourceKey', () => {
  it('uses a metadata-only local key for standalone files', () => {
    expect(resolveLightTableSaveSourceKey(null, null, 'My image.psd'))
      .toBe('local:My%20image.psd');
  });

  it('preserves hosted and recipe provenance keys', () => {
    expect(resolveLightTableSaveSourceKey('media/current.png', null, 'local.png'))
      .toBe('media/current.png');
    expect(resolveLightTableSaveSourceKey('media/current.png', {
      sourceFileKey: 'media/original.png',
      settings: createDefaultAdjustments()
    }, 'local.png')).toBe('media/original.png');
  });
});
