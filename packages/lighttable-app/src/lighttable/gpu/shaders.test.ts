import { describe, expect, it } from 'vitest';
// The package's ESM entry is not exposed through package exports, so tests import it directly.
// @ts-expect-error The public declaration belongs to the package root and describes this same class.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import {
  BASIC_CORRECTION_WGSL,
  DISPLAY_RESOLVE_WGSL,
  DISPLAY_TO_LINEAR_WGSL,
  DOWNSAMPLE_WGSL,
  CREATIVE_GRADE_WGSL,
  DOCUMENT_THUMBNAIL_WGSL,
  FULLSCREEN_VERTEX_WGSL,
  GAUSSIAN_BLUR_WGSL,
  GLOBAL_GRADE_MIX_WGSL,
  HISTOGRAM_WGSL,
  MASK_VIEWPORT_BLIT_WGSL,
  OUTPUT_TRANSFORM_WGSL,
  POINT_COLOR_RANGE_VIEWPORT_WGSL,
  REFERENCE_DIFFERENCE_METRICS_WGSL,
  VIEWPORT_BLIT_WGSL
} from './shaders';
import {
  WAVELET_DETAIL_HORIZONTAL_WGSL,
  WAVELET_DETAIL_VERTICAL_WGSL
} from './waveletDetailShaders';
import {
  PHOTOSHOP_BLEND_PROFILE_OFFSET,
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET,
  PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_OFFSET,
  PHOTOSHOP_LEVELS_CHANNELS_OFFSET,
  PHOTOSHOP_PAYLOAD_OFFSET,
  PHOTOSHOP_VIBRANCE_OFFSET
} from './adjustmentUniform';
import {
  GRAIN_BLUR_WGSL,
  GRAIN_COMPOSITE_WGSL,
  GRAIN_GENERATE_WGSL
} from '../effects/grain/shaders';
import {
  HALATION_BLUR_WGSL,
  HALATION_COMPOSITE_WGSL,
  HALATION_EXTRACT_WGSL
} from '../effects/halation/shaders';
import { CHROMATIC_ABERRATION_WGSL } from '../effects/chromaticAberration/shaders';
import { LENS_DISTORTION_WGSL } from '../effects/lensDistortion/shaders';
import { VIGNETTE_WGSL } from '../effects/vignette/shaders';
import {
  LENS_BLUR_COMPOSITE_WGSL,
  LENS_BLUR_DEPTH_REFINE_WGSL,
  LENS_BLUR_DOWNSAMPLE_WGSL,
  LENS_BLUR_GATHER_WGSL
} from '../effects/lensBlur/shaders';
import {
  WARP_DISPLACEMENT_DEBUG_WGSL,
  WARP_FIELD_COMPUTE_WGSL,
  WARP_RENDER_WGSL
} from '../effects/warp/shaders';
import {
  COMBINED_SCOPE_ANALYSIS_WGSL,
  HUE_DISTRIBUTION_ANALYSIS_WGSL,
  HUE_DISTRIBUTION_DISPLAY_WGSL,
  PARADE_SCOPE_ANALYSIS_WGSL,
  PARADE_SCOPE_DISPLAY_WGSL,
  VECTOR_SCOPE_ANALYSIS_WGSL,
  VECTOR_SCOPE_DISPLAY_WGSL
} from './scopeShaders';
import {
  ADJUSTMENT_LAYER_MIX_WGSL,
  BLUR_BRUSH_DAB_WGSL,
  BRUSH_DAB_WGSL,
  LAYER_COMPOSITE_WGSL,
  LAYER_EXPORT_WGSL,
  LAYER_FILL_COLOR_WGSL,
  LAYER_INVERT_COLORS_WGSL,
  LAYER_STYLE_EFFECT_WGSL,
  LAYER_STYLE_GAUSSIAN_BLUR_WGSL,
  LAYER_STYLE_SHAPE_WGSL,
  SAMPLED_BRUSH_DAB_WGSL,
  TONE_BRUSH_DAB_WGSL,
  SELECTION_COMBINE_WGSL,
  SELECTION_FEATHER_WGSL,
  SELECTION_RESAMPLE_WGSL,
  SELECTION_SHAPE_WGSL
} from '../editor/rendering/layerShaders';
import {
  LAYER_MASK_DECODE_WGSL,
  LAYER_SOURCE_DECODE_WGSL
} from '../editor/rendering/layerSourceDecodeShaders';
import {
  LAYER_TRANSFORM_WGSL,
  SELECTION_TRANSFORM_WGSL
} from '../editor/rendering/transformShaders';
import {
  ALIGNMENT_GRADIENT_WGSL,
  ALIGNMENT_REPROJECT_WGSL,
  ALIGNMENT_SCORE_TRANSLATION_WGSL
} from '../editor/autoAlign/alignmentShaders';

const renderShaders = [
  ['lens distortion', LENS_DISTORTION_WGSL],
  ['chromatic aberration', CHROMATIC_ABERRATION_WGSL],
  ['post-crop vignette', VIGNETTE_WGSL],
  ['basic correction', BASIC_CORRECTION_WGSL],
  ['downsample', DOWNSAMPLE_WGSL],
  ['gaussian blur', GAUSSIAN_BLUR_WGSL],
  ['creative grade', CREATIVE_GRADE_WGSL],
  ['wavelet Detail horizontal', WAVELET_DETAIL_HORIZONTAL_WGSL],
  ['wavelet Detail vertical', WAVELET_DETAIL_VERTICAL_WGSL],
  ['Global Grade strength mix', GLOBAL_GRADE_MIX_WGSL],
  ['lens blur depth refinement', LENS_BLUR_DEPTH_REFINE_WGSL],
  ['lens blur downsample', LENS_BLUR_DOWNSAMPLE_WGSL],
  ['lens blur gather', LENS_BLUR_GATHER_WGSL],
  ['lens blur composite', LENS_BLUR_COMPOSITE_WGSL],
  ['halation extract', HALATION_EXTRACT_WGSL],
  ['halation blur', HALATION_BLUR_WGSL],
  ['halation composite', HALATION_COMPOSITE_WGSL],
  ['output transform', OUTPUT_TRANSFORM_WGSL],
  ['grain generation', GRAIN_GENERATE_WGSL],
  ['grain blur', GRAIN_BLUR_WGSL],
  ['grain composite', GRAIN_COMPOSITE_WGSL],
  ['display resolve', DISPLAY_RESOLVE_WGSL],
  ['flatten display to linear', DISPLAY_TO_LINEAR_WGSL],
  ['document thumbnail', DOCUMENT_THUMBNAIL_WGSL],
  ['viewport blit', VIEWPORT_BLIT_WGSL],
  ['Point Color range viewport', POINT_COLOR_RANGE_VIEWPORT_WGSL],
  ['mask viewport blit', MASK_VIEWPORT_BLIT_WGSL],
  ['warp', WARP_RENDER_WGSL],
  ['warp displacement debug', WARP_DISPLACEMENT_DEBUG_WGSL],
  ['layer style Gaussian blur', LAYER_STYLE_GAUSSIAN_BLUR_WGSL]
] as const;

describe('LightTable WGSL modules', () => {
  it('keeps denoise in the four-scale wavelet node and sharpening in creative grade', () => {
    expect(WAVELET_DETAIL_HORIZONTAL_WGSL).toContain('negativeOne.rgb * 4.0 + center.rgb * 6.0');
    expect(WAVELET_DETAIL_VERTICAL_WGSL).toContain('array<f32, 4>');
    expect(WAVELET_DETAIL_VERTICAL_WGSL).toContain('filteredYDetail');
    expect(WAVELET_DETAIL_VERTICAL_WGSL).toContain('filteredChromaDetail');
    expect(CREATIVE_GRADE_WGSL).toContain('Noise reduction is performed by the conditional multi-pass a-trous node');
    expect(CREATIVE_GRADE_WGSL).not.toContain('applyLegacyDetailNode');
  });

  it('mixes Global Grade once after its complete pipeline', () => {
    expect(GLOBAL_GRADE_MIX_WGSL).toContain('return mix(source, graded, clamp(settings.strength');
    expect(BASIC_CORRECTION_WGSL).not.toContain('settings.strength');
    expect(CREATIVE_GRADE_WGSL).not.toContain('settings.strength');
  });
  it('avoids compound assignment to swizzles for older Dawn validators', () => {
    const allShaders = renderShaders.map(([, shader]) => shader).join('\n');
    expect(allShaders).not.toMatch(/\.[rgbaxyzw]{2,4}\s*[+\-*/]=/);
  });

  it('uses the Photoshop document-space HSL route without replacing shared Grade Color', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopRgbToHsl');
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopApplyHueSaturation');
    expect(CREATIVE_GRADE_WGSL).toContain('return photoshopEncodedDocumentToLinearSrgb(adjusted);');
    expect(CREATIVE_GRADE_WGSL).toContain('fn applySharedColorVibrance');
    expect(CREATIVE_GRADE_WGSL).toContain('fn applyGradeColorVibrance');
    expect(CREATIVE_GRADE_WGSL).toContain('var lab = linearRgbToOklab(rgb);');
  });

  it('uses the measured Photoshop compatibility path conditionally while retaining the analytic fallback and protected isolated color path', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('@binding(6) var colorVibranceCompatibilityLut');
    expect(CREATIVE_GRADE_WGSL).toContain('@binding(7) var colorVibranceColorLut');
    expect(CREATIVE_GRADE_WGSL).toContain('@binding(8) var colorBalanceTransferLut');
    expect(CREATIVE_GRADE_WGSL).toContain('fn applyPhotoshopColorVibrance');
    expect(CREATIVE_GRADE_WGSL).toContain('fn sampleExtendedUnitColorLookup');
    expect(CREATIVE_GRADE_WGSL).toContain(
      `photoshopValue(${PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET}u) > 0.5`
    );
    expect(CREATIVE_GRADE_WGSL).toContain('sampleExtendedUnitColorLookup(colorVibranceColorLut, encoded)');
    expect(CREATIVE_GRADE_WGSL).toContain('fn colorVibranceSkinProtection');
    expect(CREATIVE_GRADE_WGSL).toContain('fn colorVibranceGamutMap');
    expect(CREATIVE_GRADE_WGSL).toContain('colorVibranceChromaticAdaptation(source, mappedTemperature, tint)');
    expect(CREATIVE_GRADE_WGSL).toContain('if (kind == 15u)');
  });

  it('routes native Grade and the Color and Vibrance adjustment through one shared implementation', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn applySharedColorVibrance(');
    expect(CREATIVE_GRADE_WGSL).toMatch(
      /fn applyGradeColorVibrance[\s\S]*?return applySharedColorVibrance\(/
    );
    expect(CREATIVE_GRADE_WGSL).toMatch(
      /fn applyPhotoshopColorVibrance[\s\S]*?return applySharedColorVibrance\(/
    );
    expect(CREATIVE_GRADE_WGSL).toMatch(
      /fn applyGradeColorVibrance[\s\S]*?adjustments\.tint,[\s\S]*?0\.0,[\s\S]*?0\.0,/
    );
    expect(BASIC_CORRECTION_WGSL).not.toContain('rgb = applyChromaticAdaptation(');
  });

  it('keeps the native Grade Look distinct and before the photographic B&W mix', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('@binding(9) var gradeLookLut');
    expect(CREATIVE_GRADE_WGSL).toContain('fn sampleGradeLook');
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = sampleGradeLook(rgb);'))
      .toBeLessThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyBlackWhiteMix(rgb);'));
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyPhotoshopAdjustment(rgb);'))
      .toBeGreaterThan(CREATIVE_GRADE_WGSL.indexOf('rgb = sampleGradeLook(rgb);'));
  });

  it('uses one shared smooth scene-to-display transform instead of the old gamut clamp', () => {
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn sceneToDisplay');
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn displayShoulder');
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn chromaFitForChannel');
    expect(OUTPUT_TRANSFORM_WGSL).not.toContain('fn softGamut');
    expect(OUTPUT_TRANSFORM_WGSL).not.toContain('applyWhitesToDisplay');
  });

  it('evaluates both Whites directions inside the owning Grade tone pass', () => {
    expect(BASIC_CORRECTION_WGSL).toContain('if (whitesAmount < -0.00001 && newY < 1.0)');
    expect(BASIC_CORRECTION_WGSL).toContain('if (whitesAmount > 0.00001 && newY < 1.0)');
  });

  it('keeps creative linear output separate from display encoding', () => {
    expect(CREATIVE_GRADE_WGSL).not.toContain('linearToSrgbChannel');
    expect(CREATIVE_GRADE_WGSL).not.toContain('sceneToDisplay');
    expect(OUTPUT_TRANSFORM_WGSL).toContain('linearToSrgbChannel');
  });

  it('keeps chromatic aberration as a geometry-only pass before the correction core', () => {
    expect(CHROMATIC_ABERRATION_WGSL).toContain('sampleInput(input.uv + redShift).r');
    expect(CHROMATIC_ABERRATION_WGSL).toContain('sampleInput(input.uv - blueShift).b');
    expect(CHROMATIC_ABERRATION_WGSL).not.toContain('linearToSrgb');
    expect(CHROMATIC_ABERRATION_WGSL).not.toContain('srgbToLinear');
  });

  it('uses bounded aspect-correct source geometry for lens distortion', () => {
    expect(LENS_DISTORTION_WGSL).toContain('let aspect = dimensions.x / dimensions.y;');
    expect(LENS_DISTORTION_WGSL).toContain('let edgeSafeScale = 1.0 / max(1.0, cornerFactor);');
    expect(LENS_DISTORTION_WGSL).toContain('return clamp(sourceCentered');
  });

  it('keeps Lens Blur depth-aware, optical and occlusion separated', () => {
    expect(LENS_BLUR_DEPTH_REFINE_WGSL).toContain('guideWeight');
    expect(LENS_BLUR_DEPTH_REFINE_WGSL).toContain('lensDistortionSourceUv');
    expect(LENS_BLUR_GATHER_WGSL).toContain('backgroundAccept');
    expect(LENS_BLUR_GATHER_WGSL).toContain('foregroundCoverage');
    expect(LENS_BLUR_GATHER_WGSL).toContain('apertureSample');
    expect(LENS_BLUR_GATHER_WGSL).toContain('sampleRotation');
    expect(LENS_BLUR_GATHER_WGSL).toContain('sourceReach');
    expect(LENS_BLUR_GATHER_WGSL).toContain('tileOcclusion');
    expect(LENS_BLUR_GATHER_WGSL).toContain('gatherSamples');
    expect(LENS_BLUR_COMPOSITE_WGSL).toContain('foreground.rgb + rgb * (1.0 - foreground.a)');
  });

  it('classifies Color Mixer hues before applying shared global Color', () => {
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorMixer(rgb);'))
      .toBeLessThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyGradeColorVibrance(rgb);'));
  });

  it('applies Color Grading after global color in the creative grade', () => {
    const globalColor = CREATIVE_GRADE_WGSL.indexOf('rgb = applyGradeColorVibrance(rgb);');
    const grading = CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorGrading(rgb);');
    expect(globalColor).toBeLessThan(grading);
    expect(OUTPUT_TRANSFORM_WGSL).toContain('let vignetted = applyVignette(source.rgb, input.uv);');
  });

  it('uses a true white-anchored Lift after colour transforms and before Curves', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('return vec3f(lift) + rgb * (1.0 - lift);');
    const grading = CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorGrading(rgb);');
    const lift = CREATIVE_GRADE_WGSL.indexOf('rgb = applyLift(rgb);');
    const curves = CREATIVE_GRADE_WGSL.indexOf('rgb = applyCustomCurves(rgb);');
    expect(grading).toBeLessThan(lift);
    expect(lift).toBeLessThan(curves);
  });

  it('keeps Dehaze signed until the final display transform', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('rgb = (rgb - vec3f(1.0)) / transmission + vec3f(1.0);');
    expect(CREATIVE_GRADE_WGSL).not.toContain('rgb = max((rgb - vec3f(1.0)) / transmission');
  });

  it('applies the perceptually shaped GPU curve LUT in the linear creative grade', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('@group(0) @binding(4) var curveLut: texture_2d<f32>;');
    expect(CREATIVE_GRADE_WGSL).toContain('fn linearToCurveDomain');
    expect(CREATIVE_GRADE_WGSL).toContain('fn curveDomainToLinear');
    const curves = CREATIVE_GRADE_WGSL.indexOf('rgb = applyCustomCurves(rgb);');
    expect(curves).toBeGreaterThan(0);
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn applyVignette');
  });

  it('normalizes grading masks and protects black and white endpoints', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('return weights / max(dot(weights, vec3f(1.0)), 0.000001)');
    expect(CREATIVE_GRADE_WGSL).toContain('fn colorGradingEndpointGuard');
    expect(CREATIVE_GRADE_WGSL).toContain('let protectBlack = smoothstep(0.0, 0.045, position)');
    expect(CREATIVE_GRADE_WGSL).toContain('let protectWhite = 1.0 - smoothstep(0.94, 1.0, position)');
  });

  it('evaluates the three Color Mixer channels from one shared periodic selection', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn colorMixerValues');
    expect(CREATIVE_GRADE_WGSL).not.toContain('fn colorMixerCurve');
    const mixerFunction = CREATIVE_GRADE_WGSL.slice(
      CREATIVE_GRADE_WGSL.indexOf('fn colorMixerValues'),
      CREATIVE_GRADE_WGSL.indexOf('fn colorMixerNodeRange')
    );
    expect(mixerFunction.match(/1\.0 - cos\(hue - centers\[index\]\)/g)).toHaveLength(1);
  });

  it('evaluates the native eight-range B&W mix after global color and before grading', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn applyBlackWhiteMix');
    expect(CREATIVE_GRADE_WGSL).toContain('adjustments.blackWhiteMix[2].x < 0.5');
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyBlackWhiteMix(rgb);'))
      .toBeGreaterThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyGradeColorVibrance(rgb);'));
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyBlackWhiteMix(rgb);'))
      .toBeLessThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorGrading(rgb);'));
  });

  it('evaluates Point Color as an order-independent three-dimensional selection', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn applyPointColor');
    expect(CREATIVE_GRADE_WGSL).toContain('uncovered *= 1.0 - weight');
    expect(CREATIVE_GRADE_WGSL).toContain('rgb = applyPointColor(rgb);');
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyPointColor(rgb);'))
      .toBeGreaterThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorMixer(rgb);'));
  });

  it('uses the exact pre-Point boundary for the presentation-only range view', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn applyCreativeBeforePointColor');
    expect(CREATIVE_GRADE_WGSL).toContain('fn pointColorInput');
    expect(POINT_COLOR_RANGE_VIEWPORT_WGSL).toContain('pointColorSelectionWeight(');
    expect(POINT_COLOR_RANGE_VIEWPORT_WGSL).toContain('var pointColorInputTexture');
  });

  it('locks the complete fused Grade processing order', () => {
    const operations = [
      'var rgb = applyDetailNode(centerRgb, uv);',
      'if (abs(adjustments.texture) > 0.00001)',
      'if (abs(adjustments.clarity) > 0.00001)',
      'if (abs(adjustments.dehaze) > 0.00001)',
      'rgb = applyColorMixer(rgb);',
      'rgb = applyPointColor(rgb);',
      'rgb = applyGradeColorVibrance(rgb);',
      'rgb = applyBlackWhiteMix(rgb);',
      'rgb = applyColorGrading(rgb);',
      'rgb = applyLift(rgb);',
      'rgb = applyCustomCurves(rgb);',
      'rgb = applyGradientMap(rgb, input.uv * vec2f(textureDimensions(correctedTexture)));',
      'rgb = applyPhotoshopAdjustment(rgb);'
    ];
    const positions = operations.map((operation) => CREATIVE_GRADE_WGSL.indexOf(operation));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('allows global mixer saturation through the low-chroma protection path', () => {
    expect(CREATIVE_GRADE_WGSL).not.toContain('if (chromaProtection <= 0.00001)');
    expect(CREATIVE_GRADE_WGSL).toContain('let saturationProtection = mix(1.0, chromaProtection, saturationSelection)');
  });

  it('parses the fullscreen vertex module', () => {
    expect(() => new WgslReflect(FULLSCREEN_VERTEX_WGSL)).not.toThrow();
  });

  it.each(renderShaders)('parses the %s render module', (_name, shader) => {
    expect(() => new WgslReflect(`${FULLSCREEN_VERTEX_WGSL}\n${shader}`)).not.toThrow();
  });

  it('parses the Warp displacement compute module', () => {
    expect(() => new WgslReflect(WARP_FIELD_COMPUTE_WGSL)).not.toThrow();
  });

  it('stores Warp XY displacement as one packed pair of half floats', () => {
    expect(WARP_FIELD_COMPUTE_WGSL).toContain('texture_storage_2d<r32uint, write>');
    expect(WARP_FIELD_COMPUTE_WGSL).toContain('pack2x16float(displacement)');
    expect(WARP_RENDER_WGSL).toContain('unpack2x16float');
  });

  it('uses the shared fullscreen vertex output contract for Warp rendering', () => {
    expect(WARP_RENDER_WGSL).toContain('fn main(input: VertexOutput)');
    expect(WARP_RENDER_WGSL).not.toContain('FullscreenOutput');
  });

  it('keeps the Warp displacement diagnostic independent from source pixels', () => {
    expect(WARP_DISPLACEMENT_DEBUG_WGSL).toContain('displacementTexture');
    expect(WARP_DISPLACEMENT_DEBUG_WGSL).not.toContain('sourceTexture');
  });

  it.each([
    ['layer source decode', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_SOURCE_DECODE_WGSL}`],
    ['layer mask decode', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_MASK_DECODE_WGSL}`],
    ['layer export', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_EXPORT_WGSL}`],
    ['layer composite', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_COMPOSITE_WGSL}`],
    ['layer style effect', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_EFFECT_WGSL}`],
    ['adjustment layer mix', `${FULLSCREEN_VERTEX_WGSL}\n${ADJUSTMENT_LAYER_MIX_WGSL}`],
    ['layer color fill', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_FILL_COLOR_WGSL}`],
    ['layer color invert', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_INVERT_COLORS_WGSL}`],
    ['selection shape', `${FULLSCREEN_VERTEX_WGSL}\n${SELECTION_SHAPE_WGSL}`],
    ['selection combine', `${FULLSCREEN_VERTEX_WGSL}\n${SELECTION_COMBINE_WGSL}`],
    ['selection feather', `${FULLSCREEN_VERTEX_WGSL}\n${SELECTION_FEATHER_WGSL}`],
    ['selection feather resample', `${FULLSCREEN_VERTEX_WGSL}\n${SELECTION_RESAMPLE_WGSL}`],
    ['layer transform', `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_TRANSFORM_WGSL}`],
    ['selection transform', `${FULLSCREEN_VERTEX_WGSL}\n${SELECTION_TRANSFORM_WGSL}`],
    ['alignment reprojection', `${FULLSCREEN_VERTEX_WGSL}\n${ALIGNMENT_REPROJECT_WGSL}`],
    ['alignment gradient', `${FULLSCREEN_VERTEX_WGSL}\n${ALIGNMENT_GRADIENT_WGSL}`],
    ['brush dabs', BRUSH_DAB_WGSL],
    ['sampled brush dabs', SAMPLED_BRUSH_DAB_WGSL],
    ['blur brush dabs', BLUR_BRUSH_DAB_WGSL]
  ])('parses the %s editor module', (_name, shader) => {
    expect(() => new WgslReflect(shader)).not.toThrow();
  });

  it('keeps transform texture sampling in uniform control flow', () => {
    expect(LAYER_TRANSFORM_WGSL).toContain('if (settings.samplingMode.x > 0.5)');
    expect(SELECTION_TRANSFORM_WGSL).toContain('if (settings.samplingMode.x > 0.5)');
    expect(LAYER_TRANSFORM_WGSL).not.toContain('if (sourceInside');
    expect(SELECTION_TRANSFORM_WGSL).not.toContain('if (sourceInside');
    expect(LAYER_TRANSFORM_WGSL).toContain('* sourceInside');
    expect(SELECTION_TRANSFORM_WGSL).toContain('* sourceInside');
  });

  it('keeps transparency checks inside the document and the outer pasteboard solid', () => {
    expect(VIEWPORT_BLIT_WGSL).toContain('let canvasBackground = vec3f(checker)');
    expect(VIEWPORT_BLIT_WGSL).toContain(
      'let pasteboardBackground = vec3f(0.086274510, 0.090196078, 0.094117647)'
    );
    expect(VIEWPORT_BLIT_WGSL).toContain('return vec4f(pasteboardBackground, 1.0)');
    expect(VIEWPORT_BLIT_WGSL).toContain('mix(canvasBackground, image.rgb, image.a)');
  });

  it('applies layer masks before opacity and premultiplied blend composition', () => {
    expect(LAYER_COMPOSITE_WGSL).toContain('@group(0) @binding(4) var maskTexture');
    expect(LAYER_COMPOSITE_WGSL).toContain('@group(0) @binding(5) var clippingTexture');
    expect(LAYER_COMPOSITE_WGSL).toContain('sampledForeground * settings.opacity * mask * clipping');
    expect(LAYER_COMPOSITE_WGSL).toContain(
      'return compositeBlend(background, foreground, i32(settings.blendMode + 0.5), settings.maskPadding.x, settings.maskPadding.y)'
    );
    expect(LAYER_COMPOSITE_WGSL).toContain(
      'blendedEncoded * background.a * foreground.a'
    );
  });

  it('uses explicit Photoshop endpoints for the Color Dodge/Burn blend family', () => {
    expect(LAYER_COMPOSITE_WGSL).toContain('if (background <= 1e-5) { return 0.0; }');
    expect(LAYER_COMPOSITE_WGSL).toContain('if (background >= 1.0 - 1e-5) { return 1.0; }');
    expect(LAYER_COMPOSITE_WGSL).toContain(
      'if (foreground >= 1.0 - 1e-5) { return 1.0; }'
    );
    expect(LAYER_COMPOSITE_WGSL).toContain(
      'return select(0.0, 1.0, background >= 0.5)'
    );
    expect(LAYER_COMPOSITE_WGSL).toContain('return hardMix(background, foreground)');
  });

  it('mixes an adjustment result through its opacity, semantic mask and clipping base', () => {
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain('@group(0) @binding(4) var maskTexture');
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain('@group(0) @binding(5) var clippingTexture');
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain('let mask = select(\n    1.0,');
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain('settings.opacity * mask * clipping');
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain('settings.blendMode');
    expect(ADJUSTMENT_LAYER_MIX_WGSL).toContain(
      'let outputEncoded = mix(sourceEncoded, blendedEncoded, amount)'
    );
  });

  it('keeps Photoshop Exposure on its measured 2.2 bridge without changing Grade', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('let photoshopLinear = pow(max(encoded, vec3f(0.0)), vec3f(2.2))');
    expect(CREATIVE_GRADE_WGSL).toContain('vec3f(1.0 / (2.2 * gamma))');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb(correctedEncoded)');
    expect(BASIC_CORRECTION_WGSL).toContain('rgb *= exp2(adjustments.exposureEV)');
  });

  it('keeps legacy Photoshop Vibrance separate from shared Grade Color and Vibrance', () => {
    const offset = PHOTOSHOP_VIBRANCE_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
    expect(CREATIVE_GRADE_WGSL).toContain(`photoshopValue(${offset}u)`);
    expect(CREATIVE_GRADE_WGSL).toContain(`photoshopValue(${offset + 1}u)`);
    expect(CREATIVE_GRADE_WGSL).toContain('let endpointScale = select(');
    expect(CREATIVE_GRADE_WGSL).toContain('0.2882153 * rgb.r + 0.7127024 * rgb.g');
    expect(CREATIVE_GRADE_WGSL).toContain('return applyPhotoshopVibrance(rgb)');
    expect(CREATIVE_GRADE_WGSL).toContain('rgb = applyGradeColorVibrance(rgb)');
  });

  it('evaluates Photoshop Brightness/Contrast in the encoded document profile', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('samplePhotoshopBrightnessContrastLut(encoded.r)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopLinearSrgbToEncodedDocument(rgb)');
    expect(CREATIVE_GRADE_WGSL).toContain(
      `photoshopValue(${PHOTOSHOP_BLEND_PROFILE_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET}u) > 0.5`
    );
    expect(CREATIVE_GRADE_WGSL).toContain(
      `photoshopValue(${PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET}u + left)`
    );
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb');
    expect(CREATIVE_GRADE_WGSL).toContain('let pivot = 127.0 / 255.0');
    expect(CREATIVE_GRADE_WGSL).toContain('1.0 / max(1.0 - contrast / 100.0');
    expect(CREATIVE_GRADE_WGSL).toContain('if (brightness < 0.0)');
  });

  it('evaluates Photoshop Levels in the encoded document profile', () => {
    const channelOffset = PHOTOSHOP_LEVELS_CHANNELS_OFFSET - PHOTOSHOP_PAYLOAD_OFFSET;
    expect(CREATIVE_GRADE_WGSL).toContain('let encoded = photoshopLinearSrgbToEncodedDocument(rgb)');
    expect(CREATIVE_GRADE_WGSL).toContain(`applyPhotoshopLevelsChannel(encoded.r, ${channelOffset}u)`);
    expect(CREATIVE_GRADE_WGSL).toContain(`applyPhotoshopLevelsChannel(encoded.g, ${channelOffset + 5}u)`);
    expect(CREATIVE_GRADE_WGSL).toContain(`applyPhotoshopLevelsChannel(encoded.b, ${channelOffset + 10}u)`);
    expect(CREATIVE_GRADE_WGSL).toContain('applyPhotoshopLevelsChannel(adjusted.r, 4u)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb(adjusted)');
  });

  it('evaluates Photoshop Photo Filter as D50 transmittance before luminosity preservation', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopLinearSrgbToD50Xyz');
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopD50XyzToLinearSrgb');
    expect(CREATIVE_GRADE_WGSL).toContain('filterXyz / d50White');
    expect(CREATIVE_GRADE_WGSL).toContain('let encodedFiltered = clamp(');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopSetBlendLuminosity(');
    expect(CREATIVE_GRADE_WGSL).not.toMatch(/\btarget\s*:/);
  });

  it('evaluates Photoshop Black & White from encoded neutral and chroma components', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('let gray = clamp(minimum + chroma * authoredMix / 100.0');
    expect(CREATIVE_GRADE_WGSL).toContain('let encodedTint = photoshopLinearSrgbToEncodedDocument');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopSetBlendLuminosity(encodedTint, gray)');
    expect(CREATIVE_GRADE_WGSL).not.toContain('let mixScale = mix(1.0, authoredMix');
  });

  it('evaluates Photoshop Channel Mixer and Constant in encoded document channels', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('let red = dot(encoded, vec3f(photoshopValue(43u)');
    expect(CREATIVE_GRADE_WGSL).toContain('let mixed = select(vec3f(red, green, blue), vec3f(red)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb(clamp(mixed');
  });

  it('evaluates Photoshop Invert in encoded document channels', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb(vec3f(1.0) - encoded)');
    expect(CREATIVE_GRADE_WGSL).not.toContain('if (kind == 11u) { return vec3f(1.0) - rgb; }');
  });

  it('evaluates Photoshop Posterize with encoded lower-inclusive buckets', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('ceil(encoded * levels) - vec3f(1.0)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb(buckets / (levels - 1.0))');
  });

  it('evaluates Photoshop Threshold from rounded encoded blend luminosity', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('let luminosityCode = dot(encoded, vec3f(0.30, 0.59, 0.11)) * 255.0');
    expect(CREATIVE_GRADE_WGSL).toContain('round(luminosityCode)');
  });

  it('evaluates every authored Photoshop Selective Color range in encoded document RGB', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopSelectiveColorRange(');
    expect(CREATIVE_GRADE_WGSL).toContain('59u + rangeIndex * 4u');
    expect(CREATIVE_GRADE_WGSL).toContain('let neutralScale = 1.0 - 0.5 *');
    expect(CREATIVE_GRADE_WGSL).not.toContain('let familyWeight = select(chroma');
  });

  it('keeps Photoshop Gradient Map cubic interpolation separate from native Grade gradients', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('fn photoshopClassicGradientAmount(amount: f32)');
    expect(CREATIVE_GRADE_WGSL).toContain('(flags & 16u) != 0u');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopBlendLuminosity(photoshopLinearSrgbToEncodedDocument(rgb))');
  });

  it('transforms layer pixels and masks through their independent document transforms', () => {
    expect(LAYER_COMPOSITE_WGSL).toContain('inverseRow0: vec4f');
    expect(LAYER_COMPOSITE_WGSL).toContain('inverseRow1: vec4f');
    expect(LAYER_COMPOSITE_WGSL).toContain('let sourceInside = select(');
    expect(LAYER_COMPOSITE_WGSL).toContain('textureSample(foregroundTexture, sourceSampler, sourceUv) * sourceInside');
    expect(LAYER_COMPOSITE_WGSL).toContain('maskInverseRow0: vec4f');
    expect(LAYER_COMPOSITE_WGSL).toContain('maskInverseRow1: vec4f');
    expect(LAYER_COMPOSITE_WGSL).toContain('let transformedMask = evaluatedMask(maskUv) * maskInside');
    expect(LAYER_COMPOSITE_WGSL).toContain('let mask = select(1.0, transformedMask');
    expect(LAYER_COMPOSITE_WGSL).not.toContain('evaluatedMask(sourceUv)');
    expect(LAYER_COMPOSITE_WGSL).toContain('settings.maskFeather > 0.01');
    expect(LAYER_COMPOSITE_WGSL).toContain('settings.maskDensity');
  });

  it('presents an isolated mask through its document-space transform', () => {
    expect(MASK_VIEWPORT_BLIT_WGSL).toContain(
      '@group(0) @binding(3) var<uniform> maskPresentation: MaskPresentationUniforms'
    );
    expect(MASK_VIEWPORT_BLIT_WGSL).toContain('maskPresentation.inverseRow0.xyz');
    expect(MASK_VIEWPORT_BLIT_WGSL).toContain('maskPresentation.inverseRow1.xyz');
    expect(MASK_VIEWPORT_BLIT_WGSL).toContain('maskPixel / maskPresentation.canvasSize');
  });

  it('materializes the Layer Style shape without a synthetic background blend', () => {
    expect(() => new WgslReflect(`${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_SHAPE_WGSL}`)).not.toThrow();
    expect(LAYER_STYLE_SHAPE_WGSL).toContain('return sampled * coverage');
    expect(LAYER_STYLE_SHAPE_WGSL).toContain('maskInverseRow0: vec4f');
    expect(LAYER_STYLE_SHAPE_WGSL).toContain('evaluatedMask(maskUv)');
    expect(LAYER_STYLE_SHAPE_WGSL).not.toContain('evaluatedMask(sourceUv)');
    expect(LAYER_STYLE_SHAPE_WGSL).not.toContain('backgroundTexture');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('return clamp(value / (4.0 + f32(sampleCount) * 4.0), 0.0, 1.0)');
    expect(LAYER_STYLE_EFFECT_WGSL).not.toContain('if (index < directionCount)');
    expect(LAYER_STYLE_EFFECT_WGSL).not.toContain('\n    normal =');
    expect(LAYER_STYLE_EFFECT_WGSL).not.toMatch(/\btextureSample\(/);
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('textureSampleLevel(');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('return select(0.0, clamp(sampled, 0.0, 1.0), inside)');
  });

  it('keeps every Layer Style family on the bounded premultiplied-alpha path', () => {
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let effectAlpha = clamp(alpha, 0.0, 1.0)');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let shadow = vec4f(settings.color0.rgb * alpha, alpha)');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let glow = vec4f(settings.color0.rgb * alpha, alpha)');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let alpha = shape.a * shapedCoverage(absent, choke, noise, pixel, true) * opacity');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let alpha = shapedCoverage(coverage, choke, noise, pixel, false) * shape.a * opacity');
    expect(LAYER_STYLE_EFFECT_WGSL).toContain('let coverage = contourAt(abs(first - second)) * shape.a');
    expect(LAYER_STYLE_EFFECT_WGSL).not.toContain('vec4f(settings.color0.rgb, alpha)');
  });

  it('avoids Dawn-reserved target identifiers in editor shaders', () => {
    const editorShaders = [LAYER_COMPOSITE_WGSL, LAYER_STYLE_SHAPE_WGSL, LAYER_STYLE_EFFECT_WGSL, LAYER_EXPORT_WGSL, LAYER_INVERT_COLORS_WGSL, BRUSH_DAB_WGSL, BLUR_BRUSH_DAB_WGSL, TONE_BRUSH_DAB_WGSL, SELECTION_SHAPE_WGSL, SELECTION_COMBINE_WGSL].join('\n');
    expect(editorShaders).not.toMatch(/\btarget\b/);
  });

  it('limits brush coverage with the active selection mask', () => {
    expect(BRUSH_DAB_WGSL).toContain('var selectionMask: texture_2d<f32>');
    expect(BRUSH_DAB_WGSL).toContain('coverage * selectionCoverage');
  });

  it('keeps Blur Brush source and destination textures separated', () => {
    expect(BLUR_BRUSH_DAB_WGSL).toContain('var sourceTexture: texture_2d<f32>');
    expect(BLUR_BRUSH_DAB_WGSL).toContain('textureSampleLevel(');
    expect(BLUR_BRUSH_DAB_WGSL).toContain('textureLoad(selectionMask');
  });

  it('keeps tone brushes parseable, selection-aware and GPU-local', () => {
    expect(() => new WgslReflect(TONE_BRUSH_DAB_WGSL)).not.toThrow();
    expect(TONE_BRUSH_DAB_WGSL).toContain('var sourceTexture: texture_2d<f32>');
    expect(TONE_BRUSH_DAB_WGSL).toContain('textureLoad(selectionMask');
    expect(TONE_BRUSH_DAB_WGSL).toContain('fn toneTargetChannel');
    expect(TONE_BRUSH_DAB_WGSL).toContain('toneTargetCurves');
    expect(TONE_BRUSH_DAB_WGSL).toContain('tone.vibrance');
  });

  it('uses a derivative-continuous Density feather for Warp stamps', () => {
    expect(WARP_FIELD_COMPUTE_WGSL).toContain('fn smootherstep01');
    expect(WARP_FIELD_COMPUTE_WGSL).toContain('let coreRadius = density * 0.75');
    expect(WARP_FIELD_COMPUTE_WGSL).not.toContain('let exponent = mix(2.75, 0.65');
  });

  it('matches Healing Brush colour and derivative adaptation at the dab boundary', () => {
    expect(() => new WgslReflect(SAMPLED_BRUSH_DAB_WGSL)).not.toThrow();
    expect(SAMPLED_BRUSH_DAB_WGSL).toContain('fn biharmonicBoundaryCorrection');
    expect(SAMPLED_BRUSH_DAB_WGSL).toContain(
      'let boundaryDifference = straightColor(destinationBoundary)',
    );
    expect(SAMPLED_BRUSH_DAB_WGSL).toContain('outerDifference - boundaryDifference');
    expect(SAMPLED_BRUSH_DAB_WGSL).toContain('sourceSettings.tuning.x');
    expect(SAMPLED_BRUSH_DAB_WGSL).not.toContain('fn lowFrequency');
  });

  it('projects brush fragments from layer-local into document space', () => {
    expect(BRUSH_DAB_WGSL).toContain('forwardRow0: vec4f');
    expect(BRUSH_DAB_WGSL).toContain('forwardRow1: vec4f');
    expect(BRUSH_DAB_WGSL).toContain('let localPixel = input.position.xy');
    expect(BRUSH_DAB_WGSL).toContain(
      'dot(canvas.forwardRow0.xyz, vec3f(localPixel, 1.0))',
    );
    expect(BRUSH_DAB_WGSL).toContain(
      'dot(canvas.forwardRow1.xyz, vec3f(localPixel, 1.0))',
    );
    expect(BRUSH_DAB_WGSL).toContain(
      'let delta = (documentPixel - input.centerSizeHardness.xy) / radius',
    );
    expect(BRUSH_DAB_WGSL).toContain('oriented.y /= max(input.tip.x, 0.05)');
    expect(BRUSH_DAB_WGSL).toContain('let distance = length(oriented) / roughRadius');
  });

  it('fills through selection coverage and preserves premultiplied transparency when requested', () => {
    expect(LAYER_FILL_COLOR_WGSL).toContain('textureLoad(selectionTexture');
    expect(LAYER_FILL_COLOR_WGSL).toContain('settings.color.a, source.a, settings.preserveTransparency > 0.5');
    expect(LAYER_FILL_COLOR_WGSL).toContain('settings.color.rgb * alpha');
    expect(LAYER_FILL_COLOR_WGSL).toContain('return mix(source, filled, selection)');
    expect(LAYER_FILL_COLOR_WGSL).toContain('settings.maskChannel > 0.5');
  });

  it('keeps selection combine settings compatible with its 16-byte CPU uniform', () => {
    expect(SELECTION_COMBINE_WGSL).toContain('padding0: f32');
    expect(SELECTION_COMBINE_WGSL).toContain('padding1: f32');
    expect(SELECTION_COMBINE_WGSL).toContain('padding2: f32');
    expect(SELECTION_COMBINE_WGSL).not.toContain('padding: vec3f');
  });

  it('keeps affine layer export settings compatible with its 64-byte CPU uniform', () => {
    expect(LAYER_EXPORT_WGSL).toContain('transformed: f32');
    expect(LAYER_EXPORT_WGSL).toContain('sourceIsStraightSrgb: f32');
    expect(LAYER_EXPORT_WGSL).toContain('padding2: f32');
    expect(LAYER_EXPORT_WGSL).toContain('inverseRow0: vec4f');
    expect(LAYER_EXPORT_WGSL).toContain('inverseRow1: vec4f');
    expect(LAYER_EXPORT_WGSL).toContain('sourceSize: vec2f');
    expect(LAYER_EXPORT_WGSL).toContain('outputSize: vec2f');
  });

  it('parses the translation alignment compute module', () => {
    expect(() => new WgslReflect(ALIGNMENT_SCORE_TRANSLATION_WGSL)).not.toThrow();
    // wgsl_reflect accepts some identifiers that Dawn correctly rejects.
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).not.toMatch(/\b(?:let|var)\s+target\b/);
  });

  it('keeps alignment on source-linear pixels and compact score readback', () => {
    expect(ALIGNMENT_REPROJECT_WGSL).toContain('let straight = premultiplied.rgb / max(premultiplied.a');
    expect(ALIGNMENT_REPROJECT_WGSL).not.toContain('linearToSrgb');
    expect(ALIGNMENT_GRADIENT_WGSL).toContain('let direction = gradient / max(magnitude');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('struct CandidateScore');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('min(reference.z, targetSample.z)');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('dot(reference.rg, alignedTargetDirection)');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('struct CandidateTransform');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('textureSampleLevel');
    expect(ALIGNMENT_SCORE_TRANSLATION_WGSL).toContain('@workgroup_size(64)');
  });

  it('parses the histogram compute module', () => {
    expect(() => new WgslReflect(HISTOGRAM_WGSL)).not.toThrow();
  });

  it('parses the reference difference metrics compute module', () => {
    expect(() => new WgslReflect(REFERENCE_DIFFERENCE_METRICS_WGSL)).not.toThrow();
    expect(REFERENCE_DIFFERENCE_METRICS_WGSL).toContain('atomicMax(&metrics.maximumChannelDifference');
    expect(REFERENCE_DIFFERENCE_METRICS_WGSL).toContain('maximumDifference > info.threshold');
  });

  it.each([
    ['Hue Distribution analysis', HUE_DISTRIBUTION_ANALYSIS_WGSL],
    ['RGB Parade analysis', PARADE_SCOPE_ANALYSIS_WGSL],
    ['Vectorscope analysis', VECTOR_SCOPE_ANALYSIS_WGSL],
    ['combined scope analysis', COMBINED_SCOPE_ANALYSIS_WGSL]
  ])('parses the %s compute module', (_name, shader) => {
    expect(() => new WgslReflect(shader)).not.toThrow();
  });

  it.each([
    ['Hue Distribution display', HUE_DISTRIBUTION_DISPLAY_WGSL],
    ['RGB Parade display', PARADE_SCOPE_DISPLAY_WGSL],
    ['Vectorscope display', VECTOR_SCOPE_DISPLAY_WGSL]
  ])('parses the %s render module', (_name, shader) => {
    expect(() => new WgslReflect(`${FULLSCREEN_VERTEX_WGSL}\n${shader}`)).not.toThrow();
  });

  it('keeps scope analysis separate from the image adjustment shaders', () => {
    expect(CREATIVE_GRADE_WGSL).not.toContain('ParadeBins');
    expect(CREATIVE_GRADE_WGSL).not.toContain('VectorBins');
  });

  it('excludes transparent pixels from all GPU scopes', () => {
    for (const shader of [
      HUE_DISTRIBUTION_ANALYSIS_WGSL,
      PARADE_SCOPE_ANALYSIS_WGSL,
      VECTOR_SCOPE_ANALYSIS_WGSL,
      COMBINED_SCOPE_ANALYSIS_WGSL
    ]) {
      expect(shader).toContain('if (color.a <= 0.001) { return; }');
    }
  });

  it('measures Hue Distribution in the Color Mixer perceptual domain', () => {
    expect(HUE_DISTRIBUTION_ANALYSIS_WGSL).toContain('fn linearRgbToOklab');
    expect(HUE_DISTRIBUTION_ANALYSIS_WGSL).toContain('fn perceptualHueToDisplayHue');
    expect(HUE_DISTRIBUTION_ANALYSIS_WGSL).toContain('smoothstep(0.012, 0.055, chroma)');
    expect(HUE_DISTRIBUTION_ANALYSIS_WGSL).toContain('let isDisplayEncoded');
    expect(HUE_DISTRIBUTION_DISPLAY_WGSL).toContain('fn smoothedCount');
    expect(HUE_DISTRIBUTION_DISPLAY_WGSL).toContain('fn interpolatedCount');
    expect(HUE_DISTRIBUTION_DISPLAY_WGSL).toContain('fwidth(edgeDistance)');
    expect(HUE_DISTRIBUTION_DISPLAY_WGSL).toContain('var trace =');
    expect(HUE_DISTRIBUTION_DISPLAY_WGSL).not.toContain('let trace =');
  });

  it('colors Vectorscope density from its measured Cb/Cr position', () => {
    expect(VECTOR_SCOPE_DISPLAY_WGSL).toContain('fn traceColorForPosition');
    expect(VECTOR_SCOPE_DISPLAY_WGSL).toContain('let cb = screenUv.x - 0.5');
    expect(VECTOR_SCOPE_DISPLAY_WGSL).toContain('let cr = 0.5 - screenUv.y');
    expect(VECTOR_SCOPE_DISPLAY_WGSL).toContain('let whiteHeat = smoothstep(0.58, 1.0, intensity)');
    expect(VECTOR_SCOPE_DISPLAY_WGSL).not.toContain('vec3f(0.63, 0.94, 0.76)');
  });
});
