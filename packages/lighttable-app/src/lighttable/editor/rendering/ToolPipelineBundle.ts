import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  BRUSH_DAB_WGSL,
  LAYER_FILL_COLOR_WGSL,
  LAYER_INVERT_COLORS_WGSL,
  RED_CHANNEL_COPY_WGSL,
  SELECTION_COMBINE_WGSL,
  SELECTION_CONTENT_COVERAGE_WGSL,
  SELECTION_COPY_WGSL,
  SELECTION_DISPLAY_COPY_WGSL,
  SELECTION_FEATHER_WGSL,
  SELECTION_SHAPE_WGSL
} from './layerShaders';
import {
  LAYER_TRANSFORM_WGSL,
  SELECTION_TRANSFORM_WGSL
} from './transformShaders';

export interface ToolPipelineBundle {
  brush: GPURenderPipeline;
  erase: GPURenderPipeline;
  fillColor: GPURenderPipeline;
  invertColors: GPURenderPipeline;
  selectionShape: GPURenderPipeline;
  selectionCombine: GPURenderPipeline;
  selectionContentCoverage: GPURenderPipeline;
  selectionFeather: GPURenderPipeline;
  selectionCopy: GPURenderPipeline;
  selectionDisplayCopy: GPURenderPipeline;
  selectionToMask: GPURenderPipeline;
  maskToSelection: GPURenderPipeline;
  transform: GPURenderPipeline;
  selectionTransform: GPURenderPipeline;
}

const cache = new WeakMap<GPUDevice, ToolPipelineBundle>();

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
  const brushModule = device.createShaderModule({ code: BRUSH_DAB_WGSL });
  const brushPipeline = (
    label: string,
    color: GPUBlendComponent,
    alpha: GPUBlendComponent
  ) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: brushModule, entryPoint: 'brushVertex' },
    fragment: {
      module: brushModule,
      entryPoint: 'brushFragment',
      targets: [{
        format: 'rgba16float',
        blend: { color, alpha }
      }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const bundle: ToolPipelineBundle = {
    brush: brushPipeline(
      'LightTable round brush',
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    ),
    erase: brushPipeline(
      'LightTable round eraser',
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    ),
    fillColor: fullscreenPipeline('LightTable fill layer color', LAYER_FILL_COLOR_WGSL),
    invertColors: fullscreenPipeline('LightTable invert layer colors', LAYER_INVERT_COLORS_WGSL),
    selectionShape: fullscreenPipeline('LightTable selection shape rasterizer', SELECTION_SHAPE_WGSL, 'r8unorm'),
    selectionCombine: fullscreenPipeline('LightTable selection boolean compositor', SELECTION_COMBINE_WGSL, 'r8unorm'),
    selectionContentCoverage: fullscreenPipeline('LightTable selected content coverage', SELECTION_CONTENT_COVERAGE_WGSL, 'r8unorm'),
    selectionFeather: fullscreenPipeline('LightTable selection feather', SELECTION_FEATHER_WGSL, 'r8unorm'),
    selectionCopy: fullscreenPipeline('LightTable selected pixel copy', SELECTION_COPY_WGSL),
    selectionDisplayCopy: fullscreenPipeline('LightTable selected display copy', SELECTION_DISPLAY_COPY_WGSL, 'rgba8unorm'),
    selectionToMask: fullscreenPipeline('LightTable selection to layer mask', RED_CHANNEL_COPY_WGSL),
    maskToSelection: fullscreenPipeline('LightTable layer mask to selection', RED_CHANNEL_COPY_WGSL, 'r8unorm'),
    transform: fullscreenPipeline('LightTable layer transform preview', LAYER_TRANSFORM_WGSL),
    selectionTransform: fullscreenPipeline('LightTable selection transform preview', SELECTION_TRANSFORM_WGSL, 'r8unorm')
  };
  cache.set(device, bundle);
  return bundle;
};
