import {
  TEXT_RENDERER_BAKEOFF_LIMITS,
  TextRendererResourceLimitError,
  copyValidatedHbGpuStorage,
  type HbGpuFixtureBundle,
  type HbGpuFixtureGlyph
} from '@lighttable/text-rendering';
import { HB_GPU_DRAW_WGSL, HB_GPU_SOURCE_REVISION } from './hbGpuShader.generated';
import type { TextPrototypeRenderMetrics, TextPrototypeSurface } from './CoverageAtlasPrototype';

const VERTEX_BYTES = 32;
const UNIFORM_BYTES = 96;

export interface HbGpuDraw {
  readonly glyphId: number;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly unitsPerEm: number;
}

const writeVertex = (
  view: DataView,
  byteOffset: number,
  position: readonly [number, number],
  texcoord: readonly [number, number],
  normal: readonly [number, number],
  emPerPos: number,
  glyphLoc: number
) => {
  [...position, ...texcoord, ...normal, emPerPos].forEach((value, index) => view.setFloat32(byteOffset + index * 4, value, true));
  view.setUint32(byteOffset + 28, glyphLoc, true);
};

export const buildHbGpuVertices = (
  glyphs: ReadonlyMap<number, HbGpuFixtureGlyph>,
  draws: readonly HbGpuDraw[]
) => {
  if (draws.length > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphs) {
    throw new TextRendererResourceLimitError('hb-gpu draw count exceeds the bakeoff limit.');
  }
  const bytes = new ArrayBuffer(draws.length * 6 * VERTEX_BYTES);
  const view = new DataView(bytes);
  const corners = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]] as const;
  draws.forEach((draw, drawIndex) => {
    const glyph = glyphs.get(draw.glyphId);
    if (!glyph || glyph.storageTexels === 0) throw new TypeError(`hb-gpu fixture has no encoded glyph ${draw.glyphId}.`);
    if (![draw.x, draw.y, draw.fontSize, draw.unitsPerEm].every(Number.isFinite)
      || draw.fontSize <= 0 || draw.unitsPerEm <= 0) throw new TypeError('hb-gpu draw values must be finite and positive.');
    const [xBearing, yBearing, width, height] = glyph.extents;
    const minX = xBearing;
    const maxX = xBearing + width;
    const minY = yBearing;
    const maxY = yBearing + height;
    const scale = draw.fontSize / draw.unitsPerEm;
    corners.forEach(([cx, cy], cornerIndex) => {
      const ex = cx ? maxX : minX;
      const ey = cy ? maxY : minY;
      writeVertex(
        view,
        (drawIndex * 6 + cornerIndex) * VERTEX_BYTES,
        [draw.x + scale * ex, draw.y - scale * ey],
        [ex, ey],
        [cx ? 1 : -1, cy ? -1 : 1],
        draw.unitsPerEm / draw.fontSize,
        glyph.storageOffset
      );
    });
  });
  return new Uint8Array(bytes);
};

export class HbGpuPrototype {
  readonly sourceRevision = HB_GPU_SOURCE_REVISION;
  private readonly storageBuffer: GPUBuffer;
  private readonly pipeline: GPURenderPipeline;
  private readonly glyphs: ReadonlyMap<number, HbGpuFixtureGlyph>;
  private disposed = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly bundle: HbGpuFixtureBundle,
    storageBuffer: GPUBuffer,
    pipeline: GPURenderPipeline
  ) {
    this.storageBuffer = storageBuffer;
    this.pipeline = pipeline;
    this.glyphs = new Map(bundle.glyphs.map((glyph) => [glyph.glyphId, glyph]));
  }

  static async create(device: GPUDevice, bundle: HbGpuFixtureBundle) {
    if (!bundle.storage.byteLength || bundle.storage.byteLength !== bundle.gpuBytes
      || bundle.gpuBytes > TEXT_RENDERER_BAKEOFF_LIMITS.maximumHbGpuBytes) {
      throw new TextRendererResourceLimitError('Invalid or oversized hb-gpu storage bundle.');
    }
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ label: 'LightTable hb-gpu bakeoff', code: HB_GPU_DRAW_WGSL });
    const info = await module.getCompilationInfo();
    if (info.messages.some((message) => message.type === 'error')) {
      await device.popErrorScope();
      throw new Error(`hb-gpu shader compilation failed: ${info.messages.map((message) => message.message).join('; ')}`);
    }
    const pipeline = device.createRenderPipeline({
      label: 'LightTable hb-gpu bakeoff pipeline',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'lighttable_hb_gpu_vertex',
        buffers: [{
          arrayStride: VERTEX_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x2' },
            { shaderLocation: 3, offset: 24, format: 'float32' },
            { shaderLocation: 4, offset: 28, format: 'uint32' }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: 'lighttable_hb_gpu_fragment',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
    const validatedStorage = copyValidatedHbGpuStorage(bundle);
    const storageBuffer = device.createBuffer({
      label: 'LightTable hb-gpu widened RGBA16I storage',
      size: bundle.storage.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    // Copy into an owned ArrayBuffer: the WebGPU API deliberately rejects
    // SharedArrayBuffer-backed views at this boundary.
    device.queue.writeBuffer(storageBuffer, 0, validatedStorage);
    const error = await device.popErrorScope();
    if (error) {
      storageBuffer.destroy();
      throw new Error(`hb-gpu prototype validation failed: ${error.message}`);
    }
    return new HbGpuPrototype(device, bundle, storageBuffer, pipeline);
  }

  async render(
    surface: TextPrototypeSurface,
    draws: readonly HbGpuDraw[],
    foreground: readonly [number, number, number, number] = [1, 1, 1, 1],
    transform: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  ) {
    this.assertUsable();
    if (![...foreground, ...transform].every(Number.isFinite)) throw new TypeError('hb-gpu paint and transform must be finite.');
    const vertices = buildHbGpuVertices(this.glyphs, draws);
    const vertexBuffer = this.device.createBuffer({
      size: Math.max(4, vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    let uniformBuffer: GPUBuffer | null = null;
    let validationScope = false;
    try {
      if (vertices.byteLength) this.device.queue.writeBuffer(vertexBuffer, 0, vertices);
    const uniforms = new Float32Array(UNIFORM_BYTES / 4);
    const [a, b, c, d, e, f] = transform;
    uniforms.set([
      2 * a / surface.width, -2 * b / surface.height, 0, 0,
      2 * c / surface.width, -2 * d / surface.height, 0, 0,
      0, 0, 1, 0,
      2 * e / surface.width - 1, 1 - 2 * f / surface.height, 0, 1
    ], 0);
    uniforms.set([surface.width, surface.height], 16);
    uniforms.set(foreground, 20);
    uniformBuffer = this.device.createBuffer({
      size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: this.storageBuffer } }
      ]
    });
    this.device.pushErrorScope('validation');
    validationScope = true;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable hb-gpu bakeoff commands' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: surface.view, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    if (draws.length) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(draws.length * 6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const error = await this.device.popErrorScope();
    validationScope = false;
    if (error) throw new Error(`hb-gpu render validation failed: ${error.message}`);
    return {
      uploadBytes: this.bundle.sourceBytes + vertices.byteLength + uniforms.byteLength,
      paddedUploadBytes: this.bundle.gpuBytes + vertices.byteLength + uniforms.byteLength,
      estimatedVramBytes: this.bundle.gpuBytes + surface.width * surface.height * 4,
      uploadCalls: 1 + (vertices.byteLength ? 1 : 0) + 1,
      drawBatches: draws.length ? 1 : 0
    } satisfies TextPrototypeRenderMetrics;
    } finally {
      if (validationScope) await this.device.popErrorScope().catch(() => null);
      vertexBuffer.destroy();
      uniformBuffer?.destroy();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.storageBuffer.destroy();
  }

  private assertUsable() {
    if (this.disposed) throw new Error('hb-gpu prototype is disposed.');
  }
}
