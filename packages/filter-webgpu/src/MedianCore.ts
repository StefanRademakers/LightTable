import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

export interface MedianPassPlan {
  readonly sampleRadius: 1 | 2;
  readonly step: number;
  readonly exact: boolean;
}

const MAX_HIERARCHICAL_STEP = 16;

/**
 * Radius 1-2 is a true square-window median. Larger windows use an exact 5x5
 * base followed by sparse 3x3 median-of-medians passes. Their accumulated
 * support equals the authored radius while work stays bounded to eight passes.
 */
export const medianPassSchedule = (radius: number): MedianPassPlan[] => {
  const normalized = Math.min(100, Math.max(1, Math.round(radius)));
  if (normalized <= 2) return [{ sampleRadius: normalized as 1 | 2, step: 1, exact: true }];
  const plan: MedianPassPlan[] = [{ sampleRadius: 2, step: 1, exact: false }];
  let remaining = normalized - 2;
  while (remaining > 0) {
    const step = Math.min(MAX_HIERARCHICAL_STEP, remaining);
    plan.push({ sampleRadius: 1, step, exact: false });
    remaining -= step;
  }
  return plan;
};

export const MEDIAN_WGSL = /* wgsl */ `
struct MedianUniforms {
  sampleRadius: i32,
  step: i32,
  padding0: u32,
  padding1: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: MedianUniforms;

@fragment
fn medianMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let center = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  var samples: array<vec4f, 25>;
  var count = 0u;
  for (var y = -2i; y <= 2i; y += 1i) {
    for (var x = -2i; x <= 2i; x += 1i) {
      if (abs(x) > params.sampleRadius || abs(y) > params.sampleRadius) { continue; }
      let position = clamp(center + vec2i(x, y) * params.step, vec2i(0), size - vec2i(1));
      samples[count] = textureLoad(sourceTexture, position, 0);
      count += 1u;
    }
  }
  // Branch-free component-wise insertion network. Median filters conventionally
  // rank RGBA independently; vector min/max sorts all four channels in parallel.
  for (var span = 1u; span < count; span += 1u) {
    var index = span;
    while (index > 0u) {
      let previous = samples[index - 1u];
      let current = samples[index];
      samples[index - 1u] = min(previous, current);
      samples[index] = max(previous, current);
      index -= 1u;
    }
  }
  return max(samples[count / 2u], vec4f(0.0));
}
`;

const MAX_PASSES = 8;
interface Runtime { readonly uniforms: readonly GPUBuffer[]; revision: number }
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: 'LightTable Median shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${MEDIAN_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable Median', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'medianMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

const payload = ({ sampleRadius, step }: MedianPassPlan) => {
  const values = new Int32Array(4);
  values[0] = sampleRadius;
  values[1] = step;
  return values;
};

export class MedianCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();

  constructor(private readonly device: GPUDevice, pool?: FilterTargetPool) {
    this.pool = pool ?? new FilterTargetPool(device, 2);
    this.ownsPool = pool === undefined;
  }

  configure(width: number, height: number) { this.pool.configure(width, height); }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string;
    readonly revision: number;
    readonly settings: P0FilterSettingsMap['median'];
  }): GPUTexture {
    const schedule = medianPassSchedule(request.settings.radius);
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: Array.from({ length: MAX_PASSES }, (_, index) => this.device.createBuffer({
          label: `LightTable Median pass ${index + 1} uniforms: ${request.key}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })),
        revision: -1
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      schedule.forEach((plan, index) => {
        this.device.queue.writeBuffer(runtime!.uniforms[index], 0, payload(plan));
      });
      runtime.revision = request.revision;
    }
    let input = source;
    for (let index = 0; index < schedule.length; index += 1) {
      const target = this.pool.acquire([input]);
      this.pass(encoder, input, target, runtime.uniforms[index], index);
      input = target;
    }
    return input;
  }

  private pass(encoder: GPUCommandEncoder, source: GPUTexture, target: GPUTexture,
    uniforms: GPUBuffer, index: number) {
    const pipeline = pipelineFor(this.device);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: uniforms } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: `LightTable Median pass ${index + 1}`, colorAttachments: [{
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
      for (const uniform of runtime.uniforms) uniform.destroy();
    }
    this.runtimes.clear();
  }
}
