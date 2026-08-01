import type { SolidPaint, VectorPath } from '@lighttable/vector-core';
import {
  RevisionedResourceCache,
  serializeVectorGeometryKey,
  type RealizedVectorGeometry,
  type ResourceCacheMetrics
} from '@lighttable/vector-rendering';
import { buildStencilFanVertices } from './fanGeometry';
import { VECTOR_COVER_WGSL, VECTOR_STENCIL_VERTEX_WGSL } from './shaders';

const SETTINGS_BYTES = 64;

interface CachedVertexBuffer {
  buffer: GPUBuffer;
  bytes: number;
  vertexCount: number;
}

interface PipelineBundle {
  nonzero: GPURenderPipeline;
  evenodd: GPURenderPipeline;
  cover: GPURenderPipeline;
}

export interface VectorFillTarget {
  colorView: GPUTextureView;
  stencilView: GPUTextureView;
  format: GPUTextureFormat;
  origin: { x: number; y: number };
  width: number;
  height: number;
}

export interface VectorFillSurface {
  color: GPUTexture;
  stencil: GPUTexture;
  colorView: GPUTextureView;
  stencilView: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
  dispose(): void;
}

const premultiplied = (paint: SolidPaint, opacity: number) => {
  const alpha = Math.max(0, Math.min(1, paint.color[3] * opacity));
  return [
    paint.color[0] * alpha,
    paint.color[1] * alpha,
    paint.color[2] * alpha,
    alpha
  ] as const;
};

export class VectorFillBackend {
  private readonly geometry: RevisionedResourceCache<CachedVertexBuffer>;
  private readonly pipelines = new Map<GPUTextureFormat, PipelineBundle>();
  private readonly settingsLayout: GPUBindGroupLayout;
  private pendingUniforms: GPUBuffer[] = [];
  private disposed = false;

  constructor(private readonly device: GPUDevice, cacheBudgetBytes = 64 * 1024 * 1024) {
    this.geometry = new RevisionedResourceCache(cacheBudgetBytes, ({ buffer }) => buffer.destroy());
    this.settingsLayout = device.createBindGroupLayout({
      label: 'LightTable vector settings layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: SETTINGS_BYTES }
      }]
    });
  }

  createSurface(width: number, height: number, format: GPUTextureFormat = 'rgba16float'): VectorFillSurface {
    this.assertUsable();
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError('Vector surface dimensions must be positive integers.');
    }
    const color = this.device.createTexture({
      label: 'LightTable vector color surface',
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
    const stencil = this.device.createTexture({
      label: 'LightTable vector stencil surface',
      size: { width, height },
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    return {
      color,
      stencil,
      colorView: color.createView(),
      stencilView: stencil.createView(),
      width,
      height,
      format,
      dispose: () => {
        color.destroy();
        stencil.destroy();
      }
    };
  }

  encodeFill(
    encoder: GPUCommandEncoder,
    path: VectorPath,
    realized: RealizedVectorGeometry,
    target: VectorFillTarget
  ) {
    this.assertUsable();
    const fill = path.style.fill;
    if (!fill || path.style.opacity <= 0 || target.width <= 0 || target.height <= 0) return false;
    const resource = this.prepareGeometry(realized);
    if (resource.vertexCount === 0) return false;
    const bundle = this.pipelineBundle(target.format);
    const settings = this.device.createBuffer({
      label: 'LightTable vector draw settings',
      size: SETTINGS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const color = premultiplied(fill, path.style.opacity);
    this.device.queue.writeBuffer(settings, 0, new Float32Array([
      target.origin.x, target.origin.y, target.width, target.height,
      path.transform.a, path.transform.b, path.transform.c, path.transform.d,
      path.transform.tx, path.transform.ty, 0, 0,
      ...color
    ]));
    const bindGroup = this.device.createBindGroup({
      label: 'LightTable vector draw settings bind group',
      layout: this.settingsLayout,
      entries: [{ binding: 0, resource: { buffer: settings } }]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable vector stencil and cover',
      colorAttachments: [{
        view: target.colorView,
        loadOp: 'load',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: target.stencilView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'discard'
      }
    });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(path.fillRule === 'evenodd' ? bundle.evenodd : bundle.nonzero);
    pass.setVertexBuffer(0, resource.buffer);
    pass.draw(resource.vertexCount);
    pass.setPipeline(bundle.cover);
    pass.setStencilReference(0);
    pass.draw(6);
    pass.end();

    this.pendingUniforms.push(settings);
    return true;
  }

  /** Call directly after queue.submit for command buffers encoded by this backend. */
  notifySubmitted() {
    this.assertUsable();
    const submitted = this.pendingUniforms.splice(0);
    if (submitted.length === 0) return Promise.resolve();
    return this.device.queue.onSubmittedWorkDone().catch(() => undefined).then(() => {
      for (const buffer of submitted) buffer.destroy();
    });
  }

  cacheMetrics(): ResourceCacheMetrics {
    return this.geometry.metrics();
  }

  invalidatePath(pathId: string) {
    return this.geometry.deleteWhere((key) => key.startsWith(`${pathId}:`));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.pendingUniforms) buffer.destroy();
    this.pendingUniforms = [];
    this.geometry.clear();
    this.pipelines.clear();
  }

  private prepareGeometry(realized: RealizedVectorGeometry) {
    const key = serializeVectorGeometryKey(realized.key);
    const cached = this.geometry.get(key);
    if (cached) return cached;
    const vertices = buildStencilFanVertices(realized);
    const bytes = Math.max(4, vertices.byteLength);
    const buffer = this.device.createBuffer({
      label: `LightTable vector geometry ${realized.key.pathId}`,
      size: bytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    if (vertices.byteLength > 0) this.device.queue.writeBuffer(buffer, 0, vertices);
    return this.geometry.set(key, {
      buffer,
      bytes,
      vertexCount: vertices.length / 2
    }, bytes);
  }

  private pipelineBundle(format: GPUTextureFormat) {
    const cached = this.pipelines.get(format);
    if (cached) return cached;
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.settingsLayout] });
    const stencilModule = this.device.createShaderModule({
      label: 'LightTable vector stencil shader',
      code: VECTOR_STENCIL_VERTEX_WGSL
    });
    const coverModule = this.device.createShaderModule({
      label: 'LightTable vector cover shader',
      code: VECTOR_COVER_WGSL
    });
    const stencilPipeline = (
      label: string,
      front: GPUStencilFaceState,
      back: GPUStencilFaceState
    ) => this.device.createRenderPipeline({
      label,
      layout,
      vertex: {
        module: stencilModule,
        entryPoint: 'stencilVertex',
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
        }]
      },
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus-stencil8',
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilFront: front,
        stencilBack: back
      }
    });
    const bundle: PipelineBundle = {
      nonzero: stencilPipeline(
        'LightTable vector nonzero stencil',
        { compare: 'always', passOp: 'increment-wrap' },
        { compare: 'always', passOp: 'decrement-wrap' }
      ),
      evenodd: stencilPipeline(
        'LightTable vector evenodd stencil',
        { compare: 'always', passOp: 'invert' },
        { compare: 'always', passOp: 'invert' }
      ),
      cover: this.device.createRenderPipeline({
        label: 'LightTable vector cover',
        layout,
        vertex: { module: coverModule, entryPoint: 'coverVertex' },
        fragment: {
          module: coverModule,
          entryPoint: 'coverFragment',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'not-equal', passOp: 'zero' },
          stencilBack: { compare: 'not-equal', passOp: 'zero' }
        }
      })
    };
    this.pipelines.set(format, bundle);
    return bundle;
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Vector fill backend is disposed.');
  }
}
