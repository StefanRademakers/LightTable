import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  ADJUSTMENT_LAYER_MIX_WGSL,
  LAYER_COMPOSITE_WGSL,
  LAYER_EXPORT_WGSL,
  LAYER_MASK_DECODE_WGSL,
  LAYER_SOURCE_DECODE_WGSL,
  LAYER_STYLE_SHAPE_WGSL
} from './layerShaders';

export interface DocumentPipelineBundle {
  decode: GPURenderPipeline;
  maskDecode: GPURenderPipeline;
  exportLayer: GPURenderPipeline;
  composite: GPURenderPipeline;
  adjustmentMix: GPURenderPipeline;
  fullscreenModule: GPUShaderModule;
  styleShape: GPURenderPipeline;
}

const cache = new WeakMap<GPUDevice, DocumentPipelineBundle>();

/**
 * Owns the immutable baseline pipeline bundle shared by all document renderers
 * on one GPU device. Optional tools and effects deliberately compile elsewhere.
 */
export const documentPipelinesFor = (device: GPUDevice): DocumentPipelineBundle => {
  const cached = cache.get(device);
  if (cached) return cached;
  const fullscreenModule = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
  const create = (label: string, code: string, format: GPUTextureFormat) => device.createRenderPipeline({
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
  const bundle: DocumentPipelineBundle = {
    decode: create('LightTable layer source decode', LAYER_SOURCE_DECODE_WGSL, 'rgba16float'),
    maskDecode: create('LightTable mask source decode', LAYER_MASK_DECODE_WGSL, 'rgba16float'),
    exportLayer: create('LightTable raster layer export', LAYER_EXPORT_WGSL, 'rgba8unorm'),
    composite: create('LightTable layer compositor', LAYER_COMPOSITE_WGSL, 'rgba16float'),
    adjustmentMix: create('LightTable adjustment layer mix', ADJUSTMENT_LAYER_MIX_WGSL, 'rgba16float'),
    styleShape: create('LightTable Layer Style shape', LAYER_STYLE_SHAPE_WGSL, 'rgba16float'),
    fullscreenModule
  };
  cache.set(device, bundle);
  return bundle;
};
