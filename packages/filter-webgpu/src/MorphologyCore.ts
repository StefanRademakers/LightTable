import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

export type MorphologyMode = 'maximum' | 'minimum';
type MorphologySettings = P0FilterSettingsMap[MorphologyMode];

const MAX_PASSES = 32;
const UNIFORM_STRIDE = 256;
const DIRECT_ROUND_RADIUS = 4;

export const MORPHOLOGY_WGSL = /* wgsl */ `
struct MorphologyUniforms {
  direction: vec2i,
  step: i32,
  mode: u32,
  radius: i32,
  directRound: u32,
  padding: vec2u,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: MorphologyUniforms;

fn ranked(left: vec4f, right: vec4f) -> vec4f {
  return select(max(left, right), min(left, right), params.mode == 1u);
}

fn sampleClamped(point: vec2i, size: vec2i) -> vec4f {
  return textureLoad(sourceTexture, clamp(point, vec2i(0), size - vec2i(1)), 0);
}

@fragment
fn morphologyMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let destination = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  var result = sampleClamped(destination, size);
  if (params.directRound == 1u) {
    for (var y = -4; y <= 4; y += 1) {
      for (var x = -4; x <= 4; x += 1) {
        if (x * x + y * y <= params.radius * params.radius) {
          result = ranked(result, sampleClamped(destination + vec2i(x, y), size));
        }
      }
    }
    return result;
  }
  let delta = params.direction * params.step;
  result = ranked(result, sampleClamped(destination - delta, size));
  return ranked(result, sampleClamped(destination + delta, size));
}
`;

export interface MorphologyPass {
  readonly direction: readonly [number, number];
  readonly step: number;
  readonly directRound: boolean;
}

/** Three-tap dilation/erosion steps whose accumulated support is exactly radius. */
export const morphologyStepSchedule = (radius: number): readonly number[] => {
  const target = Math.max(0, Math.round(radius));
  const result: number[] = [];
  let support = 0;
  while (support < target) {
    const step = Math.min(support * 2 + 1, target - support);
    result.push(step);
    support += step;
  }
  return result;
};

export const morphologyPassPlan = (settings: MorphologySettings): readonly MorphologyPass[] => {
  const radius = Math.max(1, Math.round(settings.radius));
  if (settings.shape === 'round' && radius <= DIRECT_ROUND_RADIUS) {
    return [{ direction: [0, 0], step: radius, directRound: true }];
  }
  const directions = settings.shape === 'square'
    ? [[1, 0], [0, 1]] as const
    : [[1, 0], [1, 1], [0, 1], [-1, 1]] as const;
  // Four equal line segments form an octagon. This scale keeps its horizontal
  // and vertical extent equal to the authored disk radius.
  const lineRadius = settings.shape === 'square'
    ? radius
    : Math.max(1, Math.round(radius / (1 + Math.SQRT2)));
  const steps = morphologyStepSchedule(lineRadius);
  return directions.flatMap((direction) => steps.map((step) => ({
    direction, step, directRound: false
  })));
};

interface Runtime {
  readonly uniforms: GPUBuffer;
  readonly payload: ArrayBuffer;
  revision: number;
  plan: readonly MorphologyPass[];
}

const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();
const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: 'LightTable MorphologyCore shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${MORPHOLOGY_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable MorphologyCore', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'morphologyMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

/** Shared HDR/premultiplied morphology executor for Maximum and Minimum. */
export class MorphologyCore {
  private readonly pool: FilterTargetPool;
  private readonly runtimes = new Map<string, Runtime>();

  constructor(private readonly device: GPUDevice) {
    this.pool = new FilterTargetPool(device, 2);
  }

  configure(width: number, height: number): void { this.pool.configure(width, height); }

  encode<K extends MorphologyMode>(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string;
    readonly revision: number;
    readonly mode: K;
    readonly settings: P0FilterSettingsMap[K];
  }): GPUTexture {
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable MorphologyCore uniforms: ${request.key}`,
          size: MAX_PASSES * UNIFORM_STRIDE,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        }),
        payload: new ArrayBuffer(MAX_PASSES * UNIFORM_STRIDE),
        revision: -1,
        plan: []
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      runtime.plan = morphologyPassPlan(request.settings);
      if (runtime.plan.length > MAX_PASSES) throw new Error('Morphology pass plan exceeds its bounded GPU budget.');
      const view = new DataView(runtime.payload);
      runtime.plan.forEach((pass, index) => {
        const offset = index * UNIFORM_STRIDE;
        view.setInt32(offset, pass.direction[0], true);
        view.setInt32(offset + 4, pass.direction[1], true);
        view.setInt32(offset + 8, pass.step, true);
        view.setUint32(offset + 12, request.mode === 'minimum' ? 1 : 0, true);
        view.setInt32(offset + 16, Math.round(request.settings.radius), true);
        view.setUint32(offset + 20, pass.directRound ? 1 : 0, true);
      });
      this.device.queue.writeBuffer(runtime.uniforms, 0, runtime.payload, 0,
        runtime.plan.length * UNIFORM_STRIDE);
      runtime.revision = request.revision;
    }
    const pipeline = pipelineFor(this.device);
    let current = source;
    runtime.plan.forEach((_, index) => {
      const target = this.pool.acquire([current]);
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: {
            buffer: runtime!.uniforms, offset: index * UNIFORM_STRIDE, size: 32
          } }
        ]
      });
      const pass = encoder.beginRenderPass({
        label: `LightTable ${request.mode} pass ${index + 1}`,
        colorAttachments: [{
          view: target.createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      current = target;
    });
    return current;
  }

  estimatedTextureBytes(): number { return this.pool.estimatedTextureBytes(); }

  destroy(): void {
    this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.uniforms.destroy();
    this.runtimes.clear();
  }
}
