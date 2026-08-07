import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  BRUSH_DAB_WGSL,
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
  SELECTION_RESAMPLE_WGSL,
  SELECTION_SHAPE_WGSL
} from './layerShaders';
import {
  LAYER_TRANSFORM_WGSL,
  SELECTION_TRANSFORM_WGSL
} from './transformShaders';

export interface BrushPipelineBundle {
  brush: GPURenderPipeline;
  brushPreserveTransparency: GPURenderPipeline;
  erase: GPURenderPipeline;
  erasePreserveTransparency: GPURenderPipeline;
  maskBrush: GPURenderPipeline;
  maskErase: GPURenderPipeline;
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
  selectionResample: GPURenderPipeline;
  selectionCopy: GPURenderPipeline;
  selectionDisplayCopy: GPURenderPipeline;
  selectionToMask: GPURenderPipeline;
  maskToSelection: GPURenderPipeline;
  channelToSelection: GPURenderPipeline;
  transform: GPURenderPipeline;
  selectionTransform: GPURenderPipeline;
}

const brushCache = new WeakMap<GPUDevice, BrushPipelineBundle>();
const cache = new WeakMap<GPUDevice, ToolPipelineBundle>();

/** Compiles only the pipelines that can occur in a live brush gesture. */
export const brushPipelinesFor = (device: GPUDevice): BrushPipelineBundle => {
  const cached = brushCache.get(device);
  if (cached) return cached;
  const brushModule = device.createShaderModule({ code: BRUSH_DAB_WGSL });
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
  const bundle: BrushPipelineBundle = {
    brush: brushPipeline(
      'LightTable round brush',
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    ),
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
      'r8unorm'
    ),
    maskErase: brushPipeline(
      'LightTable round mask eraser',
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      'r8unorm'
    )
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
  const bundle: ToolPipelineBundle = {
    ...brushPipelinesFor(device),
    fillColor: fullscreenPipeline('LightTable fill layer color', LAYER_FILL_COLOR_WGSL),
    fillGradient: fullscreenPipeline('LightTable fill layer gradient', LAYER_FILL_GRADIENT_WGSL),
    invertColors: fullscreenPipeline('LightTable invert layer colors', LAYER_INVERT_COLORS_WGSL),
    maskFillColor: fullscreenPipeline('LightTable fill mask color', LAYER_FILL_COLOR_WGSL, 'r8unorm'),
    maskFillGradient: fullscreenPipeline('LightTable fill mask gradient', LAYER_FILL_GRADIENT_WGSL, 'r8unorm'),
    maskInvertColors: fullscreenPipeline('LightTable invert mask', LAYER_INVERT_COLORS_WGSL, 'r8unorm'),
    selectionShape: fullscreenPipeline('LightTable selection shape rasterizer', SELECTION_SHAPE_WGSL, 'r8unorm'),
    selectionCombine: fullscreenPipeline('LightTable selection boolean compositor', SELECTION_COMBINE_WGSL, 'r8unorm'),
    selectionContentCoverage: fullscreenPipeline('LightTable selected content coverage', SELECTION_CONTENT_COVERAGE_WGSL, 'r8unorm'),
    selectionFeather: fullscreenPipeline('LightTable selection feather', SELECTION_FEATHER_WGSL, 'r8unorm'),
    selectionResample: fullscreenPipeline('LightTable selection feather upscale', SELECTION_RESAMPLE_WGSL, 'r8unorm'),
    selectionCopy: fullscreenPipeline('LightTable selected pixel copy', SELECTION_COPY_WGSL),
    selectionDisplayCopy: fullscreenPipeline('LightTable selected display copy', SELECTION_DISPLAY_COPY_WGSL, 'rgba8unorm'),
    selectionToMask: fullscreenPipeline('LightTable selection to layer mask', RED_CHANNEL_COPY_WGSL, 'r8unorm'),
    maskToSelection: fullscreenPipeline('LightTable layer mask to selection', RED_CHANNEL_COPY_WGSL, 'r8unorm'),
    channelToSelection: fullscreenPipeline('LightTable composite channel to selection', COLOR_CHANNEL_COPY_WGSL, 'r8unorm'),
    transform: fullscreenPipeline('LightTable layer transform preview', LAYER_TRANSFORM_WGSL),
    selectionTransform: fullscreenPipeline('LightTable selection transform preview', SELECTION_TRANSFORM_WGSL, 'r8unorm')
  };
  cache.set(device, bundle);
  return bundle;
};
