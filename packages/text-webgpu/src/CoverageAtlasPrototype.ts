import {
  TEXT_RENDERER_BAKEOFF_LIMITS,
  TextRendererResourceLimitError,
  type PackedCoverageAtlas
} from '@lighttable/text-rendering';
import { COVERAGE_ATLAS_WGSL } from './coverageShader';

const SETTINGS_BYTES = 16;
const INSTANCE_FLOATS = 16;

export interface CoverageAtlasDraw {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly color: readonly [number, number, number, number];
  /** Column-major 2x2 transform used for rotation, shear and non-uniform scale. */
  readonly transform?: readonly [number, number, number, number];
}

export interface TextPrototypeSurface {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

export interface TextPrototypeRenderMetrics {
  readonly uploadBytes: number;
  readonly paddedUploadBytes: number;
  readonly estimatedVramBytes: number;
  readonly uploadCalls: number;
  readonly drawBatches: number;
}

const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;

export const padR8TextureRows = (atlas: PackedCoverageAtlas) => {
  const bytesPerRow = align(atlas.width, 256);
  const data = new Uint8Array(bytesPerRow * atlas.height);
  for (let row = 0; row < atlas.height; row += 1) {
    data.set(atlas.pixels.subarray(row * atlas.width, (row + 1) * atlas.width), row * bytesPerRow);
  }
  return { data, bytesPerRow };
};

const assertDimension = (value: number) => {
  if (!Number.isInteger(value) || value <= 0 || value > 8192) {
    throw new TextRendererResourceLimitError('Bakeoff surface dimensions must be integers in [1, 8192].');
  }
};

export class CoverageAtlasPrototype {
  private readonly atlasTexture: GPUTexture;
  private readonly sampler: GPUSampler;
  private readonly pipeline: GPURenderPipeline;
  private readonly atlasUploadBytes: number;
  private readonly paddedAtlasUploadBytes: number;
  private disposed = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly atlas: PackedCoverageAtlas,
    atlasTexture: GPUTexture,
    sampler: GPUSampler,
    pipeline: GPURenderPipeline,
    uploadBytes: number,
    paddedUploadBytes: number
  ) {
    this.atlasTexture = atlasTexture;
    this.sampler = sampler;
    this.pipeline = pipeline;
    this.atlasUploadBytes = uploadBytes;
    this.paddedAtlasUploadBytes = paddedUploadBytes;
  }

  static async create(device: GPUDevice, atlas: PackedCoverageAtlas) {
    if (atlas.pixels.byteLength !== atlas.width * atlas.height
      || atlas.pixels.byteLength > TEXT_RENDERER_BAKEOFF_LIMITS.maximumAtlasBytes) {
      throw new TextRendererResourceLimitError('Invalid or oversized R8 coverage atlas.');
    }
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ label: 'LightTable coverage bakeoff', code: COVERAGE_ATLAS_WGSL });
    const info = await module.getCompilationInfo();
    if (info.messages.some((message) => message.type === 'error')) {
      await device.popErrorScope();
      throw new Error(`Coverage shader compilation failed: ${info.messages.map((message) => message.message).join('; ')}`);
    }
    const pipeline = device.createRenderPipeline({
      label: 'LightTable coverage bakeoff pipeline',
      layout: 'auto',
      vertex: { module, entryPoint: 'coverageVertex' },
      fragment: {
        module,
        entryPoint: 'coverageFragment',
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
    const texture = device.createTexture({
      label: 'LightTable coverage R8 atlas',
      size: { width: atlas.width, height: atlas.height },
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const padded = padR8TextureRows(atlas);
    device.queue.writeTexture(
      { texture },
      padded.data,
      { bytesPerRow: padded.bytesPerRow, rowsPerImage: atlas.height },
      { width: atlas.width, height: atlas.height }
    );
    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const error = await device.popErrorScope();
    if (error) {
      texture.destroy();
      throw new Error(`Coverage prototype validation failed: ${error.message}`);
    }
    return new CoverageAtlasPrototype(
      device, atlas, texture, sampler, pipeline,
      atlas.pixels.byteLength, padded.data.byteLength
    );
  }

  createSurface(width: number, height: number): TextPrototypeSurface {
    this.assertUsable();
    assertDimension(width);
    assertDimension(height);
    const texture = this.device.createTexture({
      label: 'LightTable coverage bakeoff surface',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    return { texture, view: texture.createView(), width, height, dispose: () => texture.destroy() };
  }

  async render(surface: TextPrototypeSurface, draws: readonly CoverageAtlasDraw[]) {
    this.assertUsable();
    if (draws.length > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphs) {
      throw new TextRendererResourceLimitError('Coverage draw count exceeds the bakeoff limit.');
    }
    const entries = new Map(this.atlas.entries.map((entry) => [entry.key, entry]));
    const visibleDraws = draws.filter((draw) => {
      const entry = entries.get(draw.key);
      if (!entry) throw new TypeError(`Coverage atlas has no entry for ${draw.key}.`);
      return entry.width > 0 && entry.height > 0;
    });
    const visibleValues = new Float32Array(Math.max(1, visibleDraws.length) * INSTANCE_FLOATS);
    visibleDraws.forEach((draw, index) => {
      const entry = entries.get(draw.key);
      if (!entry) throw new TypeError(`Coverage atlas has no entry for ${draw.key}.`);
      const basis = draw.transform ?? [1, 0, 0, 1];
      if (![draw.x, draw.y, ...draw.color, ...basis].every(Number.isFinite)) throw new TypeError('Coverage draw values must be finite.');
      visibleValues.set([
        draw.x + basis[0] * entry.bearingX - basis[2] * entry.bearingY,
        draw.y + basis[1] * entry.bearingX - basis[3] * entry.bearingY,
        entry.width, entry.height,
        ...basis,
        entry.x, entry.y, entry.width, entry.height,
        ...draw.color
      ], index * INSTANCE_FLOATS);
    });
    const uniforms = new Float32Array([surface.width, surface.height, this.atlas.width, this.atlas.height]);
    const settingsBuffer = this.device.createBuffer({
      size: SETTINGS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    let instanceBuffer: GPUBuffer | null = null;
    let validationScope = false;
    try {
      instanceBuffer = this.device.createBuffer({
        size: Math.max(16, visibleValues.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
    this.device.queue.writeBuffer(settingsBuffer, 0, uniforms);
    if (visibleDraws.length) this.device.queue.writeBuffer(instanceBuffer, 0, visibleValues);
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: settingsBuffer } },
        { binding: 1, resource: this.atlasTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: instanceBuffer } }
      ]
    });
    this.device.pushErrorScope('validation');
    validationScope = true;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable coverage bakeoff commands' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: surface.view,
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    if (visibleDraws.length) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, visibleDraws.length);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const error = await this.device.popErrorScope();
    validationScope = false;
    if (error) throw new Error(`Coverage render validation failed: ${error.message}`);
    return {
      uploadBytes: this.atlasUploadBytes + uniforms.byteLength + (visibleDraws.length ? visibleValues.byteLength : 0),
      paddedUploadBytes: this.paddedAtlasUploadBytes + uniforms.byteLength + (visibleDraws.length ? visibleValues.byteLength : 0),
      estimatedVramBytes: this.atlas.pixels.byteLength + surface.width * surface.height * 4,
      uploadCalls: 1 + 1 + (visibleDraws.length ? 1 : 0),
      drawBatches: visibleDraws.length ? 1 : 0
    } satisfies TextPrototypeRenderMetrics;
    } finally {
      if (validationScope) await this.device.popErrorScope().catch(() => null);
      settingsBuffer.destroy();
      instanceBuffer?.destroy();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.atlasTexture.destroy();
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Coverage atlas prototype is disposed.');
  }
}
