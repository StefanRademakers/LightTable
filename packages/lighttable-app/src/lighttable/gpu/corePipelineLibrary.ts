import {
  BASIC_CORRECTION_WGSL,
  CREATIVE_GRADE_WGSL,
  DISPLAY_RESOLVE_WGSL,
  DISPLAY_TO_LINEAR_WGSL,
  DOWNSAMPLE_WGSL,
  FULLSCREEN_VERTEX_WGSL,
  GAUSSIAN_BLUR_WGSL,
  GLOBAL_GRADE_MIX_WGSL,
  HISTOGRAM_WGSL,
  CHANNEL_VIEWPORT_BLIT_WGSL,
  MASK_VIEWPORT_BLIT_WGSL,
  OUTPUT_TRANSFORM_WGSL,
  POINT_COLOR_RANGE_VIEWPORT_WGSL,
  PRECISION_SOURCE_RESOLVE_WGSL,
  REFERENCE_DIFFERENCE_METRICS_WGSL,
  VIEWPORT_BLIT_WGSL,
  VIEWPORT_DIFFERENCE_WGSL
} from './shaders';

export interface CorePipelineBundle {
  vertexModule: GPUShaderModule;
  basic: GPURenderPipeline;
  downsample: GPURenderPipeline;
  blur: GPURenderPipeline;
  creative: GPURenderPipeline;
  pointColorInput: GPURenderPipeline;
  globalGradeMix: GPURenderPipeline;
  output: GPURenderPipeline;
  precisionSourceResolve: GPURenderPipeline;
  displayResolve: GPURenderPipeline;
  displayToLinear: GPURenderPipeline;
  blit: GPURenderPipeline;
  maskBlit: GPURenderPipeline;
  channelBlit: GPURenderPipeline;
  difference: GPURenderPipeline;
  pointColorRange: GPURenderPipeline;
  differenceMetrics: GPUComputePipeline;
  histogram: GPUComputePipeline;
}

const pipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, CorePipelineBundle>>();

/**
 * Core pipelines are immutable for a device and presentation format. Keeping
 * their construction outside an editor instance prevents every document from
 * recompiling the same shader set while preserving device-loss boundaries.
 */
export const getCorePipelineBundle = (
  device: GPUDevice,
  canvasFormat: GPUTextureFormat
): CorePipelineBundle => {
  let byFormat = pipelineCache.get(device);
  if (!byFormat) {
    byFormat = new Map();
    pipelineCache.set(device, byFormat);
  }

  const cached = byFormat.get(canvasFormat);
  if (cached) return cached;

  const vertexModule = device.createShaderModule({
    label: 'LightTable fullscreen vertex shader',
    code: FULLSCREEN_VERTEX_WGSL
  });
  const createRenderPipeline = (
    label: string,
    fragmentCode: string,
    format: GPUTextureFormat,
    entryPoint = 'main'
  ) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
    fragment: {
      module: device.createShaderModule({
        label: `${label} fragment shader`,
        code: `${FULLSCREEN_VERTEX_WGSL}\n${fragmentCode}`
      }),
      entryPoint,
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const precisionSourceLayout = device.createBindGroupLayout({
    label: 'LightTable precision source resolve layout',
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'unfilterable-float', viewDimension: '2d' }
    }]
  });

  const bundle: CorePipelineBundle = {
    vertexModule,
    basic: createRenderPipeline(
      'LightTable basic correction',
      BASIC_CORRECTION_WGSL,
      'rgba16float'
    ),
    downsample: createRenderPipeline(
      'LightTable correction downsample',
      DOWNSAMPLE_WGSL,
      'rgba16float'
    ),
    blur: createRenderPipeline(
      'LightTable correction blur',
      GAUSSIAN_BLUR_WGSL,
      'rgba16float'
    ),
    creative: createRenderPipeline(
      'LightTable creative grade',
      CREATIVE_GRADE_WGSL,
      'rgba16float'
    ),
    pointColorInput: createRenderPipeline(
      'LightTable Point Color node input',
      CREATIVE_GRADE_WGSL,
      'rgba16float',
      'pointColorInput'
    ),
    globalGradeMix: createRenderPipeline(
      'LightTable Global Grade strength mix',
      GLOBAL_GRADE_MIX_WGSL,
      'rgba16float'
    ),
    output: createRenderPipeline(
      'LightTable output transform',
      OUTPUT_TRANSFORM_WGSL,
      'rgba16float'
    ),
    precisionSourceResolve: device.createRenderPipeline({
      label: 'LightTable precision source resolve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [precisionSourceLayout] }),
      vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: device.createShaderModule({
          label: 'LightTable precision source resolve fragment shader',
          code: `${FULLSCREEN_VERTEX_WGSL}\n${PRECISION_SOURCE_RESOLVE_WGSL}`
        }),
        entryPoint: 'main',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list' }
    }),
    displayResolve: createRenderPipeline(
      'LightTable display resolve',
      DISPLAY_RESOLVE_WGSL,
      'rgba8unorm'
    ),
    displayToLinear: createRenderPipeline(
      'LightTable flatten display to linear',
      DISPLAY_TO_LINEAR_WGSL,
      'rgba16float'
    ),
    blit: createRenderPipeline(
      'LightTable viewport blit',
      VIEWPORT_BLIT_WGSL,
      canvasFormat
    ),
    maskBlit: createRenderPipeline(
      'LightTable mask viewport blit',
      MASK_VIEWPORT_BLIT_WGSL,
      canvasFormat
    ),
    channelBlit: createRenderPipeline(
      'LightTable channel viewport blit',
      CHANNEL_VIEWPORT_BLIT_WGSL,
      canvasFormat
    ),
    difference: createRenderPipeline(
      'LightTable viewport difference',
      VIEWPORT_DIFFERENCE_WGSL,
      canvasFormat
    ),
    pointColorRange: createRenderPipeline(
      'LightTable Point Color range viewport',
      POINT_COLOR_RANGE_VIEWPORT_WGSL,
      canvasFormat
    ),
    differenceMetrics: device.createComputePipeline({
      label: 'LightTable reference difference metrics',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({
          label: 'LightTable reference difference metrics shader',
          code: REFERENCE_DIFFERENCE_METRICS_WGSL
        }),
        entryPoint: 'main'
      }
    }),
    histogram: device.createComputePipeline({
      label: 'LightTable histogram',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({
          label: 'LightTable histogram shader',
          code: HISTOGRAM_WGSL
        }),
        entryPoint: 'main'
      }
    })
  };

  byFormat.set(canvasFormat, bundle);
  return bundle;
};
