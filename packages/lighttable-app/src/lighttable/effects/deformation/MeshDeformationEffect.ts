import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { OptionalGpuFeature } from '../../gpu/optionalGpuFeature';
import type { LightTableEffectRuntimeCallbacks, LightTableGpuEffect } from '../types';
import { validateDeformationSurface, type DeformationSurface } from './deformationSurface';
import { packDeformationSurfaces } from './packDeformationSurfaces';

export interface MeshDeformationSettings {
  readonly opacity: number;
  readonly surfaces: readonly DeformationSurface[];
}

const arraysEqual = (left: ArrayLike<number>, right: ArrayLike<number>): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

export const MESH_DEFORMATION_BASE_FRAGMENT_WGSL = /* wgsl */`
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn main(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(sourceTexture, sourceSampler, input.uv);
}`;

export const MESH_DEFORMATION_WGSL = /* wgsl */`
struct Settings {
  canvasSize: vec2f,
  opacity: f32,
  _padding: f32,
};
struct MeshOutput {
  @builtin(position) position: vec4f,
  @location(0) sourceUv: vec2f,
  @location(1) destinationUv: vec2f,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> settings: Settings;
@vertex fn vertexMain(
  @location(0) targetPosition: vec3f,
  @location(1) sourceUv: vec2f
) -> MeshOutput {
  let destinationUv = targetPosition.xy / settings.canvasSize;
  var output: MeshOutput;
  output.position = vec4f(
    destinationUv.x * 2.0 - 1.0,
    1.0 - destinationUv.y * 2.0,
    targetPosition.z,
    1.0
  );
  output.sourceUv = sourceUv;
  output.destinationUv = destinationUv;
  return output;
}
@fragment fn fragmentMain(input: MeshOutput) -> @location(0) vec4f {
  let original = textureSample(sourceTexture, sourceSampler, input.destinationUv);
  let warped = textureSample(sourceTexture, sourceSampler, input.sourceUv);
  return mix(original, warped, settings.opacity);
}`;

export class MeshDeformationEffect implements LightTableGpuEffect<MeshDeformationSettings> {
  readonly id = 'mesh-deformation';
  readonly stage = 'source-geometry' as const;
  private readonly basePipeline: OptionalGpuFeature<GPURenderPipeline>;
  private readonly meshPipeline: OptionalGpuFeature<GPURenderPipeline>;
  private readonly settingsBuffer: GPUBuffer;
  private settings: MeshDeformationSettings = { opacity: 1, surfaces: [] };
  private width = 1;
  private height = 1;
  private output: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private targetBuffer: GPUBuffer | null = null;
  private sourceUvBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private sourceGeometry = new Float32Array();
  private indexGeometry = new Uint32Array();
  private sourceUvWidth = 0;
  private sourceUvHeight = 0;
  private indexCount = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly sampler: GPUSampler,
    vertexModule: GPUShaderModule,
    settings: MeshDeformationSettings,
    callbacks: LightTableEffectRuntimeCallbacks = {}
  ) {
    this.basePipeline = new OptionalGpuFeature({
      id: 'mesh-deformation-base',
      compile: () => device.createRenderPipelineAsync({
        label: 'LightTable mesh deformation base', layout: 'auto',
        vertex: { module: vertexModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${MESH_DEFORMATION_BASE_FRAGMENT_WGSL}` }),
          entryPoint: 'main', targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' }
      }),
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.('mesh-deformation-base', message)
    });
    this.meshPipeline = new OptionalGpuFeature({
      id: this.id,
      compile: () => device.createRenderPipelineAsync({
        label: 'LightTable indexed mesh deformation', layout: 'auto',
        vertex: {
          module: device.createShaderModule({ code: MESH_DEFORMATION_WGSL }), entryPoint: 'vertexMain',
          buffers: [
            { arrayStride: 12, attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }
            ] },
            { arrayStride: 8, attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x2' }
            ] }
          ]
        },
        fragment: {
          module: device.createShaderModule({ code: MESH_DEFORMATION_WGSL }),
          entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'
        }
      }),
      onReady: callbacks.requestRender,
      onError: (message) => callbacks.reportError?.(this.id, message)
    });
    this.settingsBuffer = device.createBuffer({
      label: 'LightTable mesh deformation settings', size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.setSettings(settings);
  }

  setSettings(settings: MeshDeformationSettings): void {
    settings.surfaces.forEach(validateDeformationSurface);
    this.settings = structuredClone(settings);
    this.uploadGeometry();
    if (this.indexCount > 0) {
      void this.basePipeline.ensure();
      void this.meshPipeline.ensure();
      this.ensureOutput();
    }
    this.writeSettings();
  }

  resize(width: number, height: number): void {
    this.output?.destroy();
    this.output = null;
    this.depth?.destroy();
    this.depth = null;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.uploadGeometry();
    this.ensureOutput();
    this.writeSettings();
  }

  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture {
    if (this.indexCount === 0) return input;
    const basePipeline = this.basePipeline.resource;
    const meshPipeline = this.meshPipeline.resource;
    if (!basePipeline || !meshPipeline) {
      void this.basePipeline.ensure();
      void this.meshPipeline.ensure();
      return input;
    }
    this.ensureOutput();
    if (!this.output || !this.depth || !this.targetBuffer || !this.sourceUvBuffer || !this.indexBuffer) return input;
    const sourceView = input.createView();
    const basePass = encoder.beginRenderPass({
      label: 'LightTable copy mesh deformation base',
      colorAttachments: [{
        view: this.output.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear', storeOp: 'store'
      }]
    });
    basePass.setPipeline(basePipeline);
    basePass.setBindGroup(0, this.device.createBindGroup({
      layout: basePipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sourceView }, { binding: 1, resource: this.sampler }
      ]
    }));
    basePass.draw(3);
    basePass.end();

    // The indexed mesh uses depth for profile-face occlusion. Keep it in a
    // separate pass: WebGPU requires every pipeline in a pass to match that
    // pass's complete color/depth attachment state.
    const meshPass = encoder.beginRenderPass({
      label: 'LightTable render indexed mesh deformation',
      colorAttachments: [{
        view: this.output.createView(), loadOp: 'load', storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depth.createView(), depthClearValue: 1,
        depthLoadOp: 'clear', depthStoreOp: 'discard'
      }
    });
    meshPass.setPipeline(meshPipeline);
    meshPass.setBindGroup(0, this.device.createBindGroup({
      layout: meshPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.settingsBuffer } }
      ]
    }));
    meshPass.setVertexBuffer(0, this.targetBuffer);
    meshPass.setVertexBuffer(1, this.sourceUvBuffer);
    meshPass.setIndexBuffer(this.indexBuffer, 'uint32');
    meshPass.drawIndexed(this.indexCount);
    meshPass.end();
    return this.output;
  }

  destroyImageResources(): void {
    this.output?.destroy();
    this.output = null;
    this.depth?.destroy();
    this.depth = null;
  }

  estimatedTextureBytes(): number {
    return this.output ? this.width * this.height * 12 : 0;
  }

  destroy(): void {
    this.destroyImageResources();
    this.targetBuffer?.destroy();
    this.sourceUvBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.settingsBuffer.destroy();
    this.basePipeline.dispose();
    this.meshPipeline.dispose();
  }

  private writeSettings(): void {
    this.device.queue.writeBuffer(
      this.settingsBuffer, 0,
      new Float32Array([this.width, this.height, Math.max(0, Math.min(1, this.settings.opacity)), 0])
    );
  }

  private uploadGeometry(): void {
    const packed = packDeformationSurfaces(this.settings.surfaces);
    this.indexCount = packed.indices.length;
    if (this.indexCount === 0) {
      this.targetBuffer?.destroy();
      this.sourceUvBuffer?.destroy();
      this.indexBuffer?.destroy();
      this.targetBuffer = null;
      this.sourceUvBuffer = null;
      this.indexBuffer = null;
      this.sourceGeometry = new Float32Array();
      this.indexGeometry = new Uint32Array();
      this.sourceUvWidth = 0;
      this.sourceUvHeight = 0;
      return;
    }
    const sourceData = packed.sourcePositions;
    const targetData = packed.targetPositions;
    const indexData = packed.indices;
    const topologyChanged = !arraysEqual(this.sourceGeometry, sourceData)
      || !arraysEqual(this.indexGeometry, indexData);

    if (!this.targetBuffer || this.targetBuffer.size !== targetData.byteLength) {
      this.targetBuffer?.destroy();
      this.targetBuffer = this.device.createBuffer({
        label: 'LightTable deformation target vertices', size: targetData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
    }
    this.device.queue.writeBuffer(this.targetBuffer, 0, targetData);

    if (topologyChanged
      || this.sourceUvWidth !== this.width
      || this.sourceUvHeight !== this.height
      || !this.sourceUvBuffer
      || !this.indexBuffer) {
      this.sourceUvBuffer?.destroy();
      this.indexBuffer?.destroy();
      const sourceUvs = sourceData.map((value, index) =>
        value / (index % 2 === 0 ? this.width : this.height));
      this.sourceUvBuffer = this.device.createBuffer({
        label: 'LightTable deformation source UVs', size: sourceUvs.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.indexBuffer = this.device.createBuffer({
        label: 'LightTable deformation indices', size: indexData.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(this.sourceUvBuffer, 0, sourceUvs);
      this.device.queue.writeBuffer(this.indexBuffer, 0, indexData);
      this.sourceGeometry = sourceData;
      this.indexGeometry = indexData;
      this.sourceUvWidth = this.width;
      this.sourceUvHeight = this.height;
    }
  }

  private ensureOutput(): void {
    if ((this.output && this.depth) || this.indexCount === 0) return;
    this.output?.destroy();
    this.depth?.destroy();
    this.output = this.device.createTexture({
      label: 'LightTable mesh deformation output',
      size: [this.width, this.height], format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.depth = this.device.createTexture({
      label: 'LightTable mesh deformation depth',
      size: [this.width, this.height], format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }
}
