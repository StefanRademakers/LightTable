import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';
import { releaseInactiveFilterRuntimes } from './FilterRuntimeCache';

export const OFFSET_WGSL = /* wgsl */ `
struct OffsetUniforms { horizontal: i32, vertical: i32, edgeMode: u32, padding: u32 }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: OffsetUniforms;

fn positiveMod(value: i32, modulus: i32) -> i32 {
  return ((value % modulus) + modulus) % modulus;
}

@fragment
fn offsetMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  let destination = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), size - vec2i(1));
  var source = destination - vec2i(params.horizontal, params.vertical);
  if (params.edgeMode == 2u) {
    source = vec2i(positiveMod(source.x, size.x), positiveMod(source.y, size.y));
  } else if (params.edgeMode == 1u) {
    source = clamp(source, vec2i(0), size - vec2i(1));
  } else if (any(source < vec2i(0)) || any(source >= size)) {
    return vec4f(0.0);
  }
  return textureLoad(sourceTexture, source, 0);
}
`;

interface Runtime { readonly uniforms: GPUBuffer; revision: number }
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({ label: 'LightTable Offset shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${OFFSET_WGSL}` });
  const pipeline = device.createRenderPipeline({ label: 'LightTable Offset', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'offsetMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' } });
  pipelines.set(device, pipeline);
  return pipeline;
};

export class OffsetCore {
  private readonly pool: FilterTargetPool;
  private readonly ownsPool: boolean;
  private readonly runtimes = new Map<string, Runtime>();
  constructor(private readonly device: GPUDevice, pool?: FilterTargetPool) {
    this.pool = pool ?? new FilterTargetPool(device, 1);
    this.ownsPool = pool === undefined;
  }
  configure(width: number, height: number) { this.pool.configure(width, height); }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string; readonly revision: number;
    readonly settings: P0FilterSettingsMap['offset'];
  }): GPUTexture {
    const { horizontal, vertical, edgeMode } = request.settings;
    if (horizontal === 0 && vertical === 0) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = { uniforms: this.device.createBuffer({ label: `LightTable Offset uniforms: ${request.key}`,
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), revision: -1 };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(16);
      const signed = new Int32Array(bytes); const unsigned = new Uint32Array(bytes);
      signed[0] = horizontal; signed[1] = vertical;
      unsigned[2] = edgeMode === 'transparent' ? 0 : edgeMode === 'clamp' ? 1 : 2;
      this.device.queue.writeBuffer(runtime.uniforms, 0, bytes);
      runtime.revision = request.revision;
    }
    const target = this.pool.acquire([source]);
    const pipeline = pipelineFor(this.device);
    const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: source.createView() },
      { binding: 1, resource: { buffer: runtime.uniforms } }
    ] });
    const pass = encoder.beginRenderPass({ label: 'LightTable Offset', colorAttachments: [{
      view: target.createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 }
    }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    return target;
  }

  estimatedTextureBytes() { return this.ownsPool ? this.pool.estimatedTextureBytes() : 0; }
  releaseInactive(activeKeys: ReadonlySet<string>): void {
    releaseInactiveFilterRuntimes(this.runtimes, activeKeys, (runtime) => runtime.uniforms.destroy());
  }
  destroy() {
    if (this.ownsPool) this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.uniforms.destroy();
    this.runtimes.clear();
  }
}
