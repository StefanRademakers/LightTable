import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

export const DISPLACE_WGSL = /* wgsl */ `
struct DisplaceUniforms {
  horizontalScale: f32,
  verticalScale: f32,
  edgeMode: u32,
  interpolation: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var mapTexture: texture_2d<f32>;
@group(0) @binding(2) var mapSampler: sampler;
@group(0) @binding(3) var<uniform> params: DisplaceUniforms;

fn positiveMod(value: i32, modulus: i32) -> i32 {
  return ((value % modulus) + modulus) % modulus;
}

fn sourceTexel(position: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  var resolved = position;
  if (params.edgeMode == 2u) {
    resolved = vec2i(positiveMod(position.x, size.x), positiveMod(position.y, size.y));
  } else if (params.edgeMode == 1u) {
    resolved = clamp(position, vec2i(0), size - vec2i(1));
  } else if (any(position < vec2i(0)) || any(position >= size)) {
    return vec4f(0.0);
  }
  return textureLoad(sourceTexture, resolved, 0);
}

fn bilinearSource(position: vec2f) -> vec4f {
  let origin = vec2i(floor(position));
  let fraction = fract(position);
  let top = mix(sourceTexel(origin), sourceTexel(origin + vec2i(1, 0)), fraction.x);
  let bottom = mix(sourceTexel(origin + vec2i(0, 1)), sourceTexel(origin + vec2i(1, 1)), fraction.x);
  return mix(top, bottom, fraction.y);
}

fn cubicWeight(value: f32) -> vec4f {
  let value2 = value * value;
  let value3 = value2 * value;
  return vec4f(
    -0.5 * value3 + value2 - 0.5 * value,
    1.5 * value3 - 2.5 * value2 + 1.0,
    -1.5 * value3 + 2.0 * value2 + 0.5 * value,
    0.5 * value3 - 0.5 * value2
  );
}

fn bicubicSource(position: vec2f) -> vec4f {
  let base = vec2i(floor(position));
  let weightsX = cubicWeight(fract(position.x));
  let weightsY = cubicWeight(fract(position.y));
  var result = vec4f(0.0);
  for (var y = 0i; y < 4i; y += 1i) {
    var row = vec4f(0.0);
    for (var x = 0i; x < 4i; x += 1i) {
      row += sourceTexel(base + vec2i(x - 1i, y - 1i)) * weightsX[x];
    }
    result += row * weightsY[y];
  }
  // Cubic ringing may produce negative premultiplied energy. Preserve HDR
  // headroom while preventing invalid negative color/alpha values.
  return max(result, vec4f(0.0));
}

@fragment
fn displaceMain(input: VertexOutput) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sourceTexture));
  let mapSample = textureSampleLevel(mapTexture, mapSampler, input.uv, 0.0);
  let mapRgb = select(vec3f(0.5), mapSample.rgb / max(mapSample.a, 1e-6), mapSample.a > 1e-6);
  let displacement = (mapRgb.rg * 2.0 - vec2f(1.0))
    * vec2f(params.horizontalScale, params.verticalScale);
  let sourcePosition = input.uv * size - vec2f(0.5) - displacement;
  if (params.interpolation == 1u) {
    return bicubicSource(sourcePosition);
  }
  return bilinearSource(sourcePosition);
}
`;

interface Runtime { readonly uniforms: GPUBuffer; revision: number }
const pipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

const pipelineFor = (device: GPUDevice) => {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const module = device.createShaderModule({
    label: 'LightTable Displace shader',
    code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${DISPLACE_WGSL}`
  });
  const pipeline = device.createRenderPipeline({
    label: 'LightTable Displace', layout: 'auto',
    vertex: { module, entryPoint: 'filterFullscreenVertex' },
    fragment: { module, entryPoint: 'displaceMain', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' }
  });
  pipelines.set(device, pipeline);
  return pipeline;
};

/** One-pass map-driven warp with explicit edge and reconstruction policies. */
export class DisplaceCore {
  private readonly pool: FilterTargetPool;
  private readonly runtimes = new Map<string, Runtime>();

  constructor(private readonly device: GPUDevice) {
    this.pool = new FilterTargetPool(device, 1);
  }

  configure(width: number, height: number) { this.pool.configure(width, height); }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, map: GPUTexture, sampler: GPUSampler,
    request: {
      readonly key: string;
      readonly revision: number;
      readonly settings: P0FilterSettingsMap['displace'];
    }): GPUTexture {
    const { horizontalScale, verticalScale, edgeMode, interpolation } = request.settings;
    if (horizontalScale === 0 && verticalScale === 0) return source;
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        uniforms: this.device.createBuffer({
          label: `LightTable Displace uniforms: ${request.key}`,
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        }),
        revision: -1
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      const bytes = new ArrayBuffer(16);
      const floats = new Float32Array(bytes);
      const unsigned = new Uint32Array(bytes);
      floats[0] = horizontalScale;
      floats[1] = verticalScale;
      unsigned[2] = edgeMode === 'transparent' ? 0 : edgeMode === 'clamp' ? 1 : 2;
      unsigned[3] = interpolation === 'bicubic' ? 1 : 0;
      this.device.queue.writeBuffer(runtime.uniforms, 0, bytes);
      runtime.revision = request.revision;
    }
    const target = this.pool.acquire([source, map]);
    const pipeline = pipelineFor(this.device);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: map.createView() },
        { binding: 2, resource: sampler },
        { binding: 3, resource: { buffer: runtime.uniforms } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable Displace', colorAttachments: [{
        view: target.createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return target;
  }

  estimatedTextureBytes() { return this.pool.estimatedTextureBytes(); }

  destroy() {
    this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.uniforms.destroy();
    this.runtimes.clear();
  }
}
