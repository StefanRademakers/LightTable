import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  BRUSH_DAB_WGSL,
  BLUR_BRUSH_DAB_WGSL,
  SAMPLED_BRUSH_DAB_WGSL,
  TONE_BRUSH_DAB_WGSL,
  COLOR_CHANNEL_COPY_WGSL,
  LAYER_FILL_COLOR_WGSL,
  LAYER_FILL_GRADIENT_WGSL,
  LAYER_INVERT_COLORS_WGSL,
  RED_CHANNEL_COPY_WGSL,
  SELECTION_COMBINE_WGSL,
  SELECTION_CONTENT_COVERAGE_WGSL,
  SELECTION_COPY_WGSL,
  SELECTION_DISPLAY_COPY_WGSL,
  SELECTION_FEATHER_WGSL,
  SELECTION_BORDER_WGSL,
  SELECTION_MORPHOLOGY_WGSL,
  SELECTION_SMOOTH_THRESHOLD_WGSL,
  SELECTION_SMOOTH_HORIZONTAL_WGSL,
  SELECTION_SMOOTH_VERTICAL_WGSL,
  SELECTION_RESAMPLE_WGSL,
  SELECTION_SHAPE_WGSL
} from './layerShaders';
import {
  LAYER_TRANSFORM_WGSL,
  SELECTION_TRANSFORM_WGSL
} from './transformShaders';
import {
  MAGIC_WAND_COMPRESS_WGSL,
  MAGIC_WAND_FINAL_WGSL,
  MAGIC_WAND_INITIALIZE_WGSL,
  MAGIC_WAND_RELAX_WGSL,
  MAGIC_WAND_SAMPLE_WGSL
} from './magicWandShaders';
import {
  SELECT_SIMILAR_CLEAR_WGSL,
  SELECT_SIMILAR_DILATE_WGSL,
  SELECT_SIMILAR_FINAL_WGSL,
  SELECT_SIMILAR_MARK_WGSL
} from './selectSimilarShaders';
import { LAYER_MASK_TEXTURE_FORMAT, SELECTION_TEXTURE_FORMAT } from './DocumentTextureFactory';

export interface BrushPipelineBundle {
  brush: GPURenderPipeline;
  blur: GPURenderPipeline;
  brushPreserveTransparency: GPURenderPipeline;
  erase: GPURenderPipeline;
  erasePreserveTransparency: GPURenderPipeline;
  maskBrush: GPURenderPipeline;
  maskErase: GPURenderPipeline;
  clone: GPURenderPipeline;
  clonePreserveTransparency: GPURenderPipeline;
  healing: GPURenderPipeline;
  healingPreserveTransparency: GPURenderPipeline;
  tone: GPURenderPipeline;
}

export interface ToolPipelineBundle extends BrushPipelineBundle {
  fillColor: GPURenderPipeline;
  fillGradient: GPURenderPipeline;
  invertColors: GPURenderPipeline;
  maskFillColor: GPURenderPipeline;
  maskFillGradient: GPURenderPipeline;
  maskInvertColors: GPURenderPipeline;
  selectionShape: GPURenderPipeline;
  selectionCombine: GPURenderPipeline;
  selectionContentCoverage: GPURenderPipeline;
  selectionFeather: GPURenderPipeline;
  selectionBorder: GPURenderPipeline;
  selectionMorphology: GPURenderPipeline;
  selectionSmoothThreshold: GPURenderPipeline;
  selectionSmoothHorizontal: GPUComputePipeline;
  selectionSmoothVertical: GPUComputePipeline;
  selectionResample: GPURenderPipeline;
  selectionCopy: GPURenderPipeline;
  selectionDisplayCopy: GPURenderPipeline;
  coverageToByte: GPURenderPipeline;
  coverageCopy: GPURenderPipeline;
  channelToSelection: GPURenderPipeline;
  transform: GPURenderPipeline;
  selectionTransform: GPURenderPipeline;
  magicWandSample: GPUComputePipeline;
  magicWandInitialize: GPUComputePipeline;
  magicWandRelax: GPUComputePipeline;
  magicWandCompress: GPUComputePipeline;
  magicWandFinal: GPURenderPipeline;
  selectSimilarClear: GPUComputePipeline;
  selectSimilarMark: GPUComputePipeline;
  selectSimilarDilate: GPUComputePipeline;
  selectSimilarFinal: GPURenderPipeline;
}

const brushCache = new WeakMap<GPUDevice, BrushPipelineBundle>();
const cache = new WeakMap<GPUDevice, ToolPipelineBundle>();

/** Compiles only the pipelines that can occur in a live brush gesture. */
export const brushPipelinesFor = (device: GPUDevice): BrushPipelineBundle => {
  const cached = brushCache.get(device);
  if (cached) return cached;
  const brushModule = device.createShaderModule({ code: BRUSH_DAB_WGSL });
  const blurBrushModule = device.createShaderModule({ code: BLUR_BRUSH_DAB_WGSL });
  const sampledBrushModule = device.createShaderModule({ code: SAMPLED_BRUSH_DAB_WGSL });
  const toneBrushModule = device.createShaderModule({ code: TONE_BRUSH_DAB_WGSL });
  const brushPipeline = (
    label: string,
    color: GPUBlendComponent,
    alpha: GPUBlendComponent,
    format: GPUTextureFormat = 'rgba16float'
  ) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: brushModule, entryPoint: 'brushVertex' },
    fragment: {
      module: brushModule,
      entryPoint: 'brushFragment',
      targets: [{ format, blend: { color, alpha } }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const sampledBrushPipeline = (
    label: string,
    entryPoint: 'cloneFragment' | 'healingFragment',
    preserveTransparency: boolean
  ) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: sampledBrushModule, entryPoint: 'brushVertex' },
    fragment: {
      module: sampledBrushModule,
      entryPoint,
      targets: [{
        format: 'rgba16float',
        blend: preserveTransparency ? {
          color: { srcFactor: 'dst-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
        } : {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        }
      }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const bundle: BrushPipelineBundle = {
    brush: brushPipeline(
      'LightTable round brush',
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    ),
    blur: device.createRenderPipeline({
      label: 'LightTable blur brush',
      layout: 'auto',
      vertex: { module: blurBrushModule, entryPoint: 'brushVertex' },
      fragment: {
        module: blurBrushModule,
        entryPoint: 'brushFragment',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            // Blur changes color, not layer coverage.
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    }),
    brushPreserveTransparency: brushPipeline(
      'LightTable round brush with transparency lock',
      // Premultiplied result: paint * coverage * destination alpha plus the
      // existing color outside coverage. Destination alpha remains exact.
      { srcFactor: 'dst-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
    ),
    erase: brushPipeline(
      'LightTable round eraser',
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    ),
    erasePreserveTransparency: brushPipeline(
      'LightTable round eraser with transparency lock',
      // Erasing is an alpha mutation. Lock Transparent Pixels therefore
      // makes the eraser an exact no-op for both color and alpha.
      { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
    ),
    maskBrush: brushPipeline(
      'LightTable round mask brush',
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      LAYER_MASK_TEXTURE_FORMAT
    ),
    maskErase: brushPipeline(
      'LightTable round mask eraser',
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      LAYER_MASK_TEXTURE_FORMAT
    ),
    clone: sampledBrushPipeline('LightTable Clone Stamp', 'cloneFragment', false),
    clonePreserveTransparency: sampledBrushPipeline(
      'LightTable Clone Stamp with transparency lock', 'cloneFragment', true
    ),
    healing: sampledBrushPipeline('LightTable Healing Brush', 'healingFragment', false),
    healingPreserveTransparency: sampledBrushPipeline(
      'LightTable Healing Brush with transparency lock', 'healingFragment', true
    ),
    tone: device.createRenderPipeline({
      label: 'LightTable tone adjustment brush',
      layout: 'auto',
      vertex: { module: toneBrushModule, entryPoint: 'brushVertex' },
      fragment: {
        module: toneBrushModule,
        entryPoint: 'brushFragment',
        targets: [{
          format: 'rgba16float',
          blend: {
            // Tone tools alter straight color while retaining exact layer alpha.
            color: { srcFactor: 'dst-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    })
  };
  brushCache.set(device, bundle);
  return bundle;
};

/**
 * Compiles the optional editing pipelines on first tool use and shares the
 * immutable pipeline bundle between document renderers on the same device.
 * Basic image open/composite never crosses this boundary.
 */
export const toolPipelinesFor = (device: GPUDevice): ToolPipelineBundle => {
  const cached = cache.get(device);
  if (cached) return cached;
  const fullscreenModule = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
  const fullscreenPipeline = (
    label: string,
    code: string,
    format: GPUTextureFormat = 'rgba16float'
  ) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: fullscreenModule, entryPoint: 'fullscreenVertex' },
    fragment: {
      module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${code}` }),
      entryPoint: 'main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const computePipeline = (label: string, code: string) => device.createComputePipeline({
    label,
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' }
  });
  const bundle: ToolPipelineBundle = {
    ...brushPipelinesFor(device),
    fillColor: fullscreenPipeline('LightTable fill layer color', LAYER_FILL_COLOR_WGSL),
    fillGradient: fullscreenPipeline('LightTable fill layer gradient', LAYER_FILL_GRADIENT_WGSL),
    invertColors: fullscreenPipeline('LightTable invert layer colors', LAYER_INVERT_COLORS_WGSL),
    maskFillColor: fullscreenPipeline('LightTable fill mask color', LAYER_FILL_COLOR_WGSL, LAYER_MASK_TEXTURE_FORMAT),
    maskFillGradient: fullscreenPipeline('LightTable fill mask gradient', LAYER_FILL_GRADIENT_WGSL, LAYER_MASK_TEXTURE_FORMAT),
    maskInvertColors: fullscreenPipeline('LightTable invert mask', LAYER_INVERT_COLORS_WGSL, LAYER_MASK_TEXTURE_FORMAT),
    selectionShape: fullscreenPipeline('LightTable selection shape rasterizer', SELECTION_SHAPE_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionCombine: fullscreenPipeline('LightTable selection boolean compositor', SELECTION_COMBINE_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionContentCoverage: fullscreenPipeline('LightTable selected content coverage', SELECTION_CONTENT_COVERAGE_WGSL, 'r8unorm'),
    selectionFeather: fullscreenPipeline('LightTable selection feather', SELECTION_FEATHER_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionBorder: fullscreenPipeline('LightTable selection border', SELECTION_BORDER_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionMorphology: fullscreenPipeline('LightTable selection morphology', SELECTION_MORPHOLOGY_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionSmoothThreshold: fullscreenPipeline(
      'LightTable selection smooth threshold',
      SELECTION_SMOOTH_THRESHOLD_WGSL,
      SELECTION_TEXTURE_FORMAT
    ),
    selectionSmoothHorizontal: computePipeline(
      'LightTable selection smooth horizontal',
      SELECTION_SMOOTH_HORIZONTAL_WGSL
    ),
    selectionSmoothVertical: computePipeline(
      'LightTable selection smooth vertical',
      SELECTION_SMOOTH_VERTICAL_WGSL
    ),
    selectionResample: fullscreenPipeline('LightTable selection feather upscale', SELECTION_RESAMPLE_WGSL, SELECTION_TEXTURE_FORMAT),
    selectionCopy: fullscreenPipeline('LightTable selected pixel copy', SELECTION_COPY_WGSL),
    selectionDisplayCopy: fullscreenPipeline('LightTable selected display copy', SELECTION_DISPLAY_COPY_WGSL, 'rgba8unorm'),
    coverageToByte: fullscreenPipeline('LightTable coverage readback conversion', RED_CHANNEL_COPY_WGSL, 'r8unorm'),
    coverageCopy: fullscreenPipeline('LightTable editable coverage copy', RED_CHANNEL_COPY_WGSL, SELECTION_TEXTURE_FORMAT),
    channelToSelection: fullscreenPipeline('LightTable source channel to selection', COLOR_CHANNEL_COPY_WGSL, SELECTION_TEXTURE_FORMAT),
    transform: fullscreenPipeline('LightTable layer transform preview', LAYER_TRANSFORM_WGSL),
    selectionTransform: fullscreenPipeline('LightTable selection transform preview', SELECTION_TRANSFORM_WGSL, SELECTION_TEXTURE_FORMAT),
    magicWandSample: computePipeline('LightTable Magic Wand reference sample', MAGIC_WAND_SAMPLE_WGSL),
    magicWandInitialize: computePipeline('LightTable Magic Wand candidates', MAGIC_WAND_INITIALIZE_WGSL),
    magicWandRelax: computePipeline('LightTable Magic Wand component relaxation', MAGIC_WAND_RELAX_WGSL),
    magicWandCompress: computePipeline('LightTable Magic Wand component compression', MAGIC_WAND_COMPRESS_WGSL),
    magicWandFinal: fullscreenPipeline('LightTable Magic Wand mask', MAGIC_WAND_FINAL_WGSL, SELECTION_TEXTURE_FORMAT),
    selectSimilarClear: computePipeline('LightTable Select Similar clear color grid', SELECT_SIMILAR_CLEAR_WGSL),
    selectSimilarMark: computePipeline('LightTable Select Similar mark colors', SELECT_SIMILAR_MARK_WGSL),
    selectSimilarDilate: computePipeline('LightTable Select Similar expand tolerance', SELECT_SIMILAR_DILATE_WGSL),
    selectSimilarFinal: fullscreenPipeline('LightTable Select Similar mask', SELECT_SIMILAR_FINAL_WGSL, SELECTION_TEXTURE_FORMAT)
  };
  cache.set(device, bundle);
  return bundle;
};
