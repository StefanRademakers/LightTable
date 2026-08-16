import { describe, expect, it } from 'vitest';
// The package's ESM entry is not exposed through package exports, so tests import it directly.
// @ts-expect-error The public declaration belongs to the package root and describes this same class.
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import {
  BASIC_CORRECTION_WGSL,
  DISPLAY_RESOLVE_WGSL,
  DOWNSAMPLE_WGSL,
  CREATIVE_GRADE_WGSL,
  DOCUMENT_THUMBNAIL_WGSL,
  FULLSCREEN_VERTEX_WGSL,
  GAUSSIAN_BLUR_WGSL,
  HISTOGRAM_WGSL,
  MASK_VIEWPORT_BLIT_WGSL,
  OUTPUT_TRANSFORM_WGSL,
  REFERENCE_DIFFERENCE_METRICS_WGSL,
  VIEWPORT_BLIT_WGSL
} from './shaders';
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
  ['basic correction', BASIC_CORRECTION_WGSL],
  ['downsample', DOWNSAMPLE_WGSL],
  ['gaussian blur', GAUSSIAN_BLUR_WGSL],
  ['creative grade', CREATIVE_GRADE_WGSL],
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
  ['document thumbnail', DOCUMENT_THUMBNAIL_WGSL],
  ['viewport blit', VIEWPORT_BLIT_WGSL],
  ['mask viewport blit', MASK_VIEWPORT_BLIT_WGSL],
  ['warp', WARP_RENDER_WGSL],
  ['warp displacement debug', WARP_DISPLACEMENT_DEBUG_WGSL],
  ['layer style Gaussian blur', LAYER_STYLE_GAUSSIAN_BLUR_WGSL]
] as const;

describe('LightTable WGSL modules', () => {
  it('avoids compound assignment to swizzles for older Dawn validators', () => {
    const allShaders = renderShaders.map(([, shader]) => shader).join('\n');
    expect(allShaders).not.toMatch(/\.[rgbaxyzw]{2,4}\s*[+\-*/]=/);
  });

  it('keeps mutable Photoshop Levels channel output writable for Dawn', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('var adjusted = mix(vec3f(outputBlack)');
    expect(CREATIVE_GRADE_WGSL).not.toContain('let adjusted = mix(vec3f(outputBlack)');
    expect(CREATIVE_GRADE_WGSL).toContain('var rotated = vec2f(');
    expect(CREATIVE_GRADE_WGSL).not.toContain('let rotated = vec2f(');
  });

  it('uses one shared smooth scene-to-display transform instead of the old gamut clamp', () => {
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn sceneToDisplay');
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn displayShoulder');
    expect(OUTPUT_TRANSFORM_WGSL).toContain('fn chromaFitForChannel');
    expect(OUTPUT_TRANSFORM_WGSL).not.toContain('fn softGamut');
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

  it('classifies Color Mixer hues before applying global Saturation and Vibrance', () => {
    expect(CREATIVE_GRADE_WGSL.indexOf('rgb = applyColorMixer(rgb);'))
      .toBeLessThan(CREATIVE_GRADE_WGSL.indexOf('rgb = applyPerceptualColor(rgb);'));
  });

  it('applies Color Grading after global color in the creative grade', () => {
    const globalColor = CREATIVE_GRADE_WGSL.indexOf('rgb = applyPerceptualColor(rgb);');
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
    expect(CREATIVE_GRADE_WGSL.match(/1\.0 - cos\(hue - centers\[index\]\)/g)).toHaveLength(1);
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

  it('evaluates Photoshop Brightness/Contrast in the encoded document profile', () => {
    expect(CREATIVE_GRADE_WGSL).toContain('samplePhotoshopBrightnessContrastLut(encoded.r)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopLinearSrgbToEncodedDocument(rgb)');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopValue(170u) > 0.5');
    expect(CREATIVE_GRADE_WGSL).toContain('photoshopEncodedDocumentToLinearSrgb');
    expect(CREATIVE_GRADE_WGSL).toContain('let pivot = 127.0 / 255.0');
    expect(CREATIVE_GRADE_WGSL).toContain('1.0 / max(1.0 - contrast / 100.0');
    expect(CREATIVE_GRADE_WGSL).toContain('if (brightness < 0.0)');
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
    expect(LAYER_EXPORT_WGSL).toContain('padding1: f32');
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
