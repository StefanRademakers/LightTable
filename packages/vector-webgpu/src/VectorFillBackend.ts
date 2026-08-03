import type { SolidPaint, VectorPath } from '@lighttable/vector-core';
import {
  buildStrokeTriangleGeometry,
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
  union: GPURenderPipeline;
  cover: GPURenderPipeline;
}

export interface VectorFillTarget {
  colorView: GPUTextureView;
  resolveView: GPUTextureView | null;
  stencilView: GPUTextureView;
  format: GPUTextureFormat;
  sampleCount: number;
  origin: { x: number; y: number };
  width: number;
  height: number;
  /** Optional target-space clip in the same coordinates as origin. */
  clip?: { x: number; y: number; width: number; height: number };
}

export interface VectorFillSurface {
  color: GPUTexture;
  renderColor: GPUTexture;
  stencil: GPUTexture;
  colorView: GPUTextureView;
  renderColorView: GPUTextureView;
  stencilView: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
  sampleCount: number;
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

const strokeGeometryIdentity = (stroke: NonNullable<VectorPath['style']['stroke']>) => JSON.stringify([
  stroke.width,
  stroke.alignment ?? 'center',
  stroke.cap,
  stroke.join,
  stroke.miterLimit,
  stroke.dash,
  stroke.dashOffset
]);

export class VectorFillBackend {
  private readonly geometry: RevisionedResourceCache<CachedVertexBuffer>;
  private readonly pipelines = new Map<string, PipelineBundle>();
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

  createSurface(
    width: number,
    height: number,
    format: GPUTextureFormat = 'rgba16float',
    antiAlias = true
  ): VectorFillSurface {
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
    const sampleCount = antiAlias ? 4 : 1;
    const renderColor = sampleCount === 1 ? color : this.device.createTexture({
      label: 'LightTable vector multisample color surface',
      size: { width, height },
      format,
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const stencil = this.device.createTexture({
      label: 'LightTable vector stencil surface',
      size: { width, height },
      format: 'depth24plus-stencil8',
      sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    return {
      color,
      renderColor,
      stencil,
      colorView: color.createView(),
      renderColorView: renderColor.createView(),
      stencilView: stencil.createView(),
      width,
      height,
      format,
      sampleCount,
      dispose: () => {
        color.destroy();
        if (renderColor !== color) renderColor.destroy();
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
    const resource = this.prepareFillGeometry(realized);
    if (resource.vertexCount === 0) return false;
    const bundle = this.pipelineBundle(target.format, target.sampleCount);
    return this.encodeGeometry(
      encoder,
      resource,
      path,
      fill,
      path.style.opacity,
      target,
      bundle,
      path.fillRule
    );
  }

  encodeStroke(
    encoder: GPUCommandEncoder,
    path: VectorPath,
    realized: RealizedVectorGeometry,
    target: VectorFillTarget
  ) {
    this.assertUsable();
    const stroke = path.style.stroke;
    if (!stroke || path.style.opacity <= 0 || target.width <= 0 || target.height <= 0) return false;
    const mesh = buildStrokeTriangleGeometry(realized, stroke);
    if (!mesh.vertices.length) return false;
    // Text can reuse one glyph path across runs with different authored stroke
    // widths while keeping geometryRevision/styleRevision at zero. Include the
    // actual mesh-affecting stroke contract so that reuse remains exact.
    const key = `stroke:${serializeVectorGeometryKey(realized.key)}:${strokeGeometryIdentity(stroke)}`;
    const resource = this.prepareVertices(key, mesh.vertices);
    const bundle = this.pipelineBundle(target.format, target.sampleCount);
    return this.encodeGeometry(
      encoder,
      resource,
      path,
      stroke.paint,
      path.style.opacity,
      target,
      bundle,
      'union'
    );
  }

  private encodeGeometry(
    encoder: GPUCommandEncoder,
    resource: CachedVertexBuffer,
    path: VectorPath,
    paint: SolidPaint,
    opacity: number,
    target: VectorFillTarget,
    bundle: PipelineBundle,
    fillRule: VectorPath['fillRule'] | 'union'
  ) {
    const scissor = target.clip ? {
      x: Math.max(0, Math.floor(target.clip.x - target.origin.x)),
      y: Math.max(0, Math.floor(target.clip.y - target.origin.y)),
      right: Math.min(target.width, Math.ceil(target.clip.x + target.clip.width - target.origin.x)),
      bottom: Math.min(target.height, Math.ceil(target.clip.y + target.clip.height - target.origin.y))
    } : null;
    if (scissor && (scissor.right <= scissor.x || scissor.bottom <= scissor.y)) return false;
    const settings = this.device.createBuffer({
      label: 'LightTable vector draw settings',
      size: SETTINGS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const color = premultiplied(paint, opacity);
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
        resolveTarget: target.resolveView ?? undefined,
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
    if (scissor) {
      pass.setScissorRect(
        scissor.x,
        scissor.y,
        scissor.right - scissor.x,
        scissor.bottom - scissor.y
      );
    }
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(fillRule === 'union'
      ? bundle.union
      : fillRule === 'evenodd' ? bundle.evenodd : bundle.nonzero);
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
    return this.geometry.deleteWhere((key) => key.includes(`:${pathId}:`));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.pendingUniforms) buffer.destroy();
    this.pendingUniforms = [];
    this.geometry.clear();
    this.pipelines.clear();
  }

  private prepareFillGeometry(realized: RealizedVectorGeometry) {
    const key = `fill:${serializeVectorGeometryKey(realized.key)}`;
    const vertices = buildStencilFanVertices(realized);
    return this.prepareVertices(key, vertices);
  }

  private prepareVertices(key: string, vertices: Float32Array<ArrayBuffer>) {
    const cached = this.geometry.get(key);
    if (cached) return cached;
    const bytes = Math.max(4, vertices.byteLength);
    const buffer = this.device.createBuffer({
      label: `LightTable vector geometry ${key}`,
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

  private pipelineBundle(format: GPUTextureFormat, sampleCount: number) {
    const key = `${format}:${sampleCount}`;
    const cached = this.pipelines.get(key);
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
      fragment: {
        module: stencilModule,
        entryPoint: 'stencilFragment',
        targets: [{ format, writeMask: 0 }]
      },
      primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' },
      multisample: { count: sampleCount },
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
      // Stroke geometry is authored as a union of consistently covered
      // triangles. A saturating, orientation-independent stencil prevents
      // very wide curves from wrapping the 8-bit counter back to zero where
      // hundreds of flattened segments overlap near the inner radius.
      union: stencilPipeline(
        'LightTable vector stroke union stencil',
        { compare: 'always', passOp: 'increment-clamp' },
        { compare: 'always', passOp: 'increment-clamp' }
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
        multisample: { count: sampleCount },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'not-equal', passOp: 'zero' },
          stencilBack: { compare: 'not-equal', passOp: 'zero' }
        }
      })
    };
    this.pipelines.set(key, bundle);
    return bundle;
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Vector fill backend is disposed.');
  }
}
