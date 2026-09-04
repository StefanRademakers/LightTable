import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import {
  ADJUSTMENT_LAYER_MIX_WGSL,
  LAYER_COMPOSITE_WGSL,
  LAYER_EXPORT_WGSL,
  LAYER_STYLE_SHAPE_WGSL
} from './layerShaders';
import { LAYER_MASK_TEXTURE_FORMAT } from './DocumentTextureFactory';
import {
  LAYER_ADOBE_RGB_SOURCE_DECODE_WGSL,
  LAYER_MASK_DECODE_WGSL,
  LAYER_SOURCE_DECODE_WGSL
} from './layerSourceDecodeShaders';

export interface DocumentPipelineBundle {
  decode: GPURenderPipeline;
  adobeRgbDecode: GPURenderPipeline;
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
  let adobeRgbDecode: GPURenderPipeline | null = null;
  let maskDecode: GPURenderPipeline | null = null;
  let exportLayer: GPURenderPipeline | null = null;
  let styleShape: GPURenderPipeline | null = null;
  const bundle: DocumentPipelineBundle = {
    decode: create('LightTable layer source decode', LAYER_SOURCE_DECODE_WGSL, 'rgba16float'),
    get adobeRgbDecode() {
      adobeRgbDecode ??= create(
        'LightTable Adobe RGB layer source decode',
        LAYER_ADOBE_RGB_SOURCE_DECODE_WGSL,
        'rgba16float'
      );
      return adobeRgbDecode;
    },
    get maskDecode() {
      maskDecode ??= create(
        'LightTable mask source decode',
        LAYER_MASK_DECODE_WGSL,
        LAYER_MASK_TEXTURE_FORMAT
      );
      return maskDecode;
    },
    get exportLayer() {
      exportLayer ??= create('LightTable raster layer export', LAYER_EXPORT_WGSL, 'rgba8unorm');
      return exportLayer;
    },
    composite: create('LightTable layer compositor', LAYER_COMPOSITE_WGSL, 'rgba16float'),
    adjustmentMix: create('LightTable adjustment layer mix', ADJUSTMENT_LAYER_MIX_WGSL, 'rgba16float'),
    get styleShape() {
      styleShape ??= create('LightTable Layer Style shape', LAYER_STYLE_SHAPE_WGSL, 'rgba16float');
      return styleShape;
    },
    fullscreenModule
  };
  cache.set(device, bundle);
  return bundle;
};
