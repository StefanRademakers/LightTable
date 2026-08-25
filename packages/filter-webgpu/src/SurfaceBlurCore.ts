import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

export const SURFACE_BLUR_WGSL = /* wgsl */ `
struct SurfaceBlurUniforms {
  direction: vec2f,
  radius: f32,
  threshold: f32,
  sampleRadius: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var guideTexture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: SurfaceBlurUniforms;

fn straightRgb(value: vec4f) -> vec3f {
  return select(vec3f(0.0), value.rgb / max(value.a, 1e-6), value.a > 1e-6);
}

@fragment
fn surfaceBlurMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let centerGuide = textureSampleLevel(guideTexture, linearSampler, input.uv, 0.0);
  let centerRgb = straightRgb(centerGuide);
  let sigma = max(params.radius * 0.5, 0.5);
  let rangeSigma = max(params.threshold, 1.0 / 255.0);
  let stepPixels = params.radius / f32(max(params.sampleRadius, 1u));
  var accumulated = vec4f(0.0);
  var totalWeight = 0.0;
  for (var index = -16i; index <= 16i; index += 1i) {
    if (abs(index) > i32(params.sampleRadius)) { continue; }
    let pixelOffset = f32(index) * stepPixels;
    let uv = clamp(input.uv + params.direction * pixelOffset / size,
      vec2f(0.5) / size, vec2f(1.0) - vec2f(0.5) / size);
    let guide = textureSampleLevel(guideTexture, linearSampler, uv, 0.0);
    let sampleValue = textureSampleLevel(sourceTexture, linearSampler, uv, 0.0);
    let colorDelta = straightRgb(guide) - centerRgb;
    let alphaDelta = guide.a - centerGuide.a;
    let rangeDistance = dot(colorDelta, colorDelta) + alphaDelta * alphaDelta;
    let spatialWeight = exp(-0.5 * pixelOffset * pixelOffset / (sigma * sigma));
    let rangeWeight = exp(-0.5 * rangeDistance / (rangeSigma * rangeSigma));
    let weight = spatialWeight * rangeWeight;
    accumulated += sampleValue * weight;
    totalWeight += weight;
  }
  return accumulated / max(totalWeight, 1e-6);
}
`;

interface Runtime {
  readonly horizontal: GPUBuffer;
  readonly vertical: GPUBuffer;
  revision: number;
}

const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: 'LightTable Surface Blur shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${SURFACE_BLUR_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable Surface Blur', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'surfaceBlurMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

const uniformPayload = (directionX: number, directionY: number,
  settings: P0FilterSettingsMap['surface-blur']) => {
  const bytes = new ArrayBuffer(32);
  const floats = new Float32Array(bytes);
  const unsigned = new Uint32Array(bytes);
  floats[0] = directionX;
  floats[1] = directionY;
  floats[2] = settings.radius;
  floats[3] = settings.threshold / 255;
  unsigned[4] = Math.min(16, Math.max(1, Math.ceil(settings.radius)));
  return bytes;
};

/**
 * Bounded two-pass joint bilateral filter. The immutable input is the guide in
 * both passes, preventing the horizontal result from weakening vertical edges.
 */
export class SurfaceBlurCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;

  constructor(private readonly device: GPUDevice, pool?: FilterTargetPool) {
    this.pool = pool ?? new FilterTargetPool(device, 2);
    this.ownsPool = pool === undefined;
  }

  configure(width: number, height: number, sampler: GPUSampler) {
    this.pool.configure(width, height);
    this.sampler = sampler;
  }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string;
    readonly revision: number;
    readonly settings: P0FilterSettingsMap['surface-blur'];
  }): GPUTexture {
    if (!this.sampler) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      const create = (axis: string) => this.device.createBuffer({
        label: `LightTable Surface Blur ${axis} uniforms: ${request.key}`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      runtime = { horizontal: create('horizontal'), vertical: create('vertical'), revision: -1 };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      this.device.queue.writeBuffer(runtime.horizontal, 0,
        uniformPayload(1, 0, request.settings));
      this.device.queue.writeBuffer(runtime.vertical, 0,
        uniformPayload(0, 1, request.settings));
      runtime.revision = request.revision;
    }
    const first = this.pool.acquire([source]);
    const second = this.pool.acquire([source, first]);
    this.pass(encoder, source, source, first, runtime.horizontal, 'horizontal');
    this.pass(encoder, first, source, second, runtime.vertical, 'vertical');
    return second;
  }

  private pass(encoder: GPUCommandEncoder, source: GPUTexture, guide: GPUTexture,
    target: GPUTexture, uniforms: GPUBuffer, axis: string) {
    const pipeline = pipelineFor(this.device);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: guide.createView() },
        { binding: 2, resource: this.sampler! },
        { binding: 3, resource: { buffer: uniforms } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: `LightTable Surface Blur ${axis}`, colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  estimatedTextureBytes() { return this.ownsPool ? this.pool.estimatedTextureBytes() : 0; }

  destroy() {
    if (this.ownsPool) this.pool.destroy();
    for (const runtime of this.runtimes.values()) {
      runtime.horizontal.destroy();
      runtime.vertical.destroy();
    }
    this.runtimes.clear();
    this.sampler = null;
  }
}
