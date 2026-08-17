import type { DetailAdjustments } from '../detail';
import { encodeFullscreenPass } from './fullscreenPass';
import {
  FULLSCREEN_VERTEX_WGSL
} from './shaders';
import {
  WAVELET_DETAIL_HORIZONTAL_WGSL,
  WAVELET_DETAIL_VERTICAL_WGSL
} from './waveletDetailShaders';

const WAVELET_STEPS = [1, 2, 4, 8] as const;
const BYTES_PER_RGBA16FLOAT_PIXEL = 8;
const ACTIVE_EPSILON = 0.00001;

interface WaveletDetailPipelines {
  horizontal: GPURenderPipeline;
  vertical: GPURenderPipeline;
}

/**
 * Shared, document-sized scratch runtime for the conditional Detail node.
 *
 * It performs four undecimated B3-spline scales. Every scale low-passes the
 * current reconstruction and shrink-filters its wavelet residual, so there is
 * no downsampling, phase shift or CPU readback. The three full-size textures
 * are allocated only while a document exists and are skipped entirely when
 * both noise-reduction amounts are neutral.
 */
export class WaveletDetailRuntime {
  private horizontalTexture: GPUTexture | null = null;
  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private readonly scaleBuffers: GPUBuffer[];
  private pipelines: WaveletDetailPipelines | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    private readonly vertexModule: GPUShaderModule
  ) {
    this.scaleBuffers = WAVELET_STEPS.map((step, index) => {
      const buffer = device.createBuffer({
        label: `LightTable wavelet Detail scale ${index + 1}`,
        size: 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(buffer, 0, new Float32Array([step, index, 0, 0]));
      return buffer;
    });
  }

  configure(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.destroyImageResources();
    this.width = width;
    this.height = height;
  }

  private ensureTextures(): void {
    if (this.horizontalTexture && this.pingTexture && this.pongTexture) return;
    if (this.width <= 0 || this.height <= 0) {
      throw new Error('Wavelet Detail runtime is not configured for the active document.');
    }
    const createTexture = (label: string) => this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.horizontalTexture = createTexture('LightTable wavelet Detail horizontal scratch');
    this.pingTexture = createTexture('LightTable wavelet Detail reconstruction A');
    this.pongTexture = createTexture('LightTable wavelet Detail reconstruction B');
  }

  private ensurePipelines(): WaveletDetailPipelines {
    if (this.pipelines) return this.pipelines;
    const createPipeline = (label: string, fragmentCode: string) =>
      this.device.createRenderPipeline({
        label,
        layout: 'auto',
        vertex: { module: this.vertexModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module: this.device.createShaderModule({
            label: `${label} fragment shader`,
            code: `${FULLSCREEN_VERTEX_WGSL}\n${fragmentCode}`
          }),
          entryPoint: 'main',
          targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' }
      });
    this.pipelines = {
      horizontal: createPipeline(
        'LightTable wavelet Detail horizontal',
        WAVELET_DETAIL_HORIZONTAL_WGSL
      ),
      vertical: createPipeline(
        'LightTable wavelet Detail vertical',
        WAVELET_DETAIL_VERTICAL_WGSL
      )
    };
    return this.pipelines;
  }

  encode(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    adjustmentBuffer: GPUBuffer,
    detail: DetailAdjustments,
    label = 'LightTable wavelet Detail'
  ): GPUTexture {
    if (
      detail.luminanceNoiseReduction <= ACTIVE_EPSILON
      && detail.colorNoiseReduction <= ACTIVE_EPSILON
    ) return source;
    this.ensureTextures();
    const pipelines = this.ensurePipelines();
    const horizontalTexture = this.horizontalTexture!;
    const pingTexture = this.pingTexture!;
    const pongTexture = this.pongTexture!;

    let current = source;
    for (let index = 0; index < WAVELET_STEPS.length; index += 1) {
      const target = index % 2 === 0 ? pingTexture : pongTexture;
      const horizontalBindGroup = this.device.createBindGroup({
        layout: pipelines.horizontal.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.scaleBuffers[index] } }
        ]
      });
      encodeFullscreenPass(
        encoder,
        pipelines.horizontal,
        horizontalBindGroup,
        horizontalTexture.createView(),
        { label: `${label}: scale ${index + 1} horizontal` }
      );

      const verticalBindGroup = this.device.createBindGroup({
        layout: pipelines.vertical.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: horizontalTexture.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: adjustmentBuffer } },
          { binding: 4, resource: { buffer: this.scaleBuffers[index] } }
        ]
      });
      encodeFullscreenPass(
        encoder,
        pipelines.vertical,
        verticalBindGroup,
        target.createView(),
        { label: `${label}: scale ${index + 1} shrink` }
      );
      current = target;
    }
    return current;
  }

  estimatedTextureBytes(): number {
    if (!this.horizontalTexture || !this.pingTexture || !this.pongTexture) return 0;
    return this.width * this.height * BYTES_PER_RGBA16FLOAT_PIXEL * 3;
  }

  destroyImageResources(): void {
    this.horizontalTexture?.destroy();
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.horizontalTexture = null;
    this.pingTexture = null;
    this.pongTexture = null;
  }

  destroy(): void {
    this.destroyImageResources();
    this.pipelines = null;
    this.width = 0;
    this.height = 0;
    for (const buffer of this.scaleBuffers) buffer.destroy();
  }
}
