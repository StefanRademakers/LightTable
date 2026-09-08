import type { LayerId, RasterMask } from '../document/documentTypes';
import type { AffineMatrix } from '../geometry/affine';
import { invertMatrix } from '../geometry/affine';
import { releaseAfterSubmittedWork } from './SubmittedResourceRetainer';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';

interface LayerMaskPixelServiceOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  layers: LayerRuntimeStore;
  dimensions(): { width: number; height: number };
  pipelines(): ToolPipelineBundle;
  createTexture(label: string, width: number, height: number): GPUTexture;
  maskTexture(layerId: LayerId): GPUTexture | null;
  invalidateLayer(layerId: LayerId): void;
  releaseSubmittedResources(): void;
  drawFullscreen(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ): void;
}

/** Owns destructive pixel projection of a raster layer's independent mask. */
export class LayerMaskPixelService {
  constructor(private readonly options: LayerMaskPixelServiceOptions) {}

  apply(layerId: LayerId, sourceToDocument: AffineMatrix, mask: RasterMask) {
    const runtime = this.options.layers.raster(layerId);
    const maskTexture = this.options.maskTexture(layerId);
    const maskInverse = invertMatrix(mask.transform);
    if (!runtime || !maskTexture || !maskInverse) return false;
    const { width: canvasWidth, height: canvasHeight } = this.options.dimensions();
    const result = this.options.createTexture(
      'LightTable applied layer mask pixels', runtime.width, runtime.height
    );
    const settings = this.options.device.createBuffer({
      label: 'LightTable apply layer mask settings',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.options.device.queue.writeBuffer(settings, 0, new Float32Array([
      sourceToDocument.a, sourceToDocument.c, sourceToDocument.tx, 0,
      sourceToDocument.b, sourceToDocument.d, sourceToDocument.ty, 0,
      maskInverse.a, maskInverse.c, maskInverse.tx, 0,
      maskInverse.b, maskInverse.d, maskInverse.ty, 0,
      runtime.width, runtime.height, canvasWidth, canvasHeight,
      mask.density, mask.feather, 0, 0
    ]));
    const pipeline = this.options.pipelines().applyLayerMask;
    const bindGroup = this.options.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: runtime.texture.createView() },
        { binding: 1, resource: maskTexture.createView() },
        { binding: 2, resource: this.options.sampler },
        { binding: 3, resource: { buffer: settings } }
      ]
    });
    const encoder = this.options.device.createCommandEncoder({ label: 'LightTable apply layer mask' });
    this.options.drawFullscreen(
      encoder, pipeline, bindGroup, result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture(
      { texture: result }, { texture: runtime.texture }, [runtime.width, runtime.height]
    );
    this.options.device.queue.submit([encoder.finish()]);
    this.options.invalidateLayer(layerId);
    this.options.releaseSubmittedResources();
    releaseAfterSubmittedWork(() => this.options.device.queue.onSubmittedWorkDone(), () => {
      result.destroy();
      settings.destroy();
    });
    return true;
  }
}
