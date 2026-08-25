import type { P0FilterSettingsMap } from '@lighttable/filter-core';
import { FILTER_FULLSCREEN_VERTEX_WGSL } from './filterShaders';
import { FilterTargetPool } from './FilterTargetPool';

const STEPS = [1, 2, 4, 8] as const;

export const WAVELET_DENOISE_HORIZONTAL_WGSL = /* wgsl */ `
struct WaveletScale { step: f32, index: f32, padding: vec2f }
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> scale: WaveletScale;

@fragment
fn waveletHorizontal(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(sourceTexture)), vec2f(1.0));
  let offset = vec2f(scale.step / dimensions.x, 0.0);
  let center = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let rgb = (
    textureSampleLevel(sourceTexture, sourceSampler, input.uv - offset * 2.0, 0.0).rgb
    + textureSampleLevel(sourceTexture, sourceSampler, input.uv - offset, 0.0).rgb * 4.0
    + center.rgb * 6.0
    + textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset, 0.0).rgb * 4.0
    + textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset * 2.0, 0.0).rgb
  ) / 16.0;
  return vec4f(rgb, center.a);
}
`;

export const WAVELET_DENOISE_VERTICAL_WGSL = /* wgsl */ `
struct WaveletScale { step: f32, index: f32, padding: vec2f }
struct DenoiseSettings {
  strength: f32,
  preserveDetails: f32,
  reduceColorNoise: f32,
  sharpenDetails: f32,
}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var horizontalTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<uniform> settings: DenoiseSettings;
@group(0) @binding(4) var<uniform> scale: WaveletScale;

fn denoiseLuminance(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }

fn retainedDetail(magnitude: f32, threshold: f32, preservation: f32) -> f32 {
  let adjusted = threshold * mix(1.45, 0.42, preservation);
  let normalized = magnitude / max(adjusted, 0.000001);
  let squared = normalized * normalized;
  return 1.0 - exp(-(squared * squared));
}

@fragment
fn waveletVertical(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2f(textureDimensions(sourceTexture)), vec2f(1.0));
  let offset = vec2f(0.0, scale.step / dimensions.y);
  let source = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  let base = (
    textureSampleLevel(horizontalTexture, sourceSampler, input.uv - offset * 2.0, 0.0).rgb
    + textureSampleLevel(horizontalTexture, sourceSampler, input.uv - offset, 0.0).rgb * 4.0
    + textureSampleLevel(horizontalTexture, sourceSampler, input.uv, 0.0).rgb * 6.0
    + textureSampleLevel(horizontalTexture, sourceSampler, input.uv + offset, 0.0).rgb * 4.0
    + textureSampleLevel(horizontalTexture, sourceSampler, input.uv + offset * 2.0, 0.0).rgb
  ) / 16.0;
  let sourceY = denoiseLuminance(source.rgb);
  let baseY = denoiseLuminance(base);
  let detailY = sourceY - baseY;
  let detailChroma = (source.rgb - vec3f(sourceY)) - (base - vec3f(baseY));
  let scaleIndex = u32(clamp(scale.index, 0.0, 3.0));
  let lumaThresholds = array<f32, 4>(0.085, 0.026, 0.007, 0.002);
  let chromaThresholds = array<f32, 4>(0.115, 0.042, 0.015, 0.005);
  let signalScale = 0.4 + 0.6 * sqrt(clamp(abs(baseY), 0.0, 1.0));
  let keepY = retainedDetail(abs(detailY), lumaThresholds[scaleIndex] * signalScale,
    settings.preserveDetails);
  let keepChroma = retainedDetail(length(detailChroma), chromaThresholds[scaleIndex],
    settings.preserveDetails);
  let filteredY = detailY * mix(1.0, keepY, settings.strength);
  let filteredChroma = detailChroma * mix(1.0, keepChroma, settings.reduceColorNoise);
  let protectedSharpen = select(0.0, detailY * keepY * settings.sharpenDetails,
    scaleIndex == 0u);
  return vec4f(base + vec3f(filteredY + protectedSharpen) + filteredChroma, source.a);
}
`;

interface Runtime { readonly settings: GPUBuffer; revision: number }
interface Pipelines { readonly horizontal: GPURenderPipeline; readonly vertical: GPURenderPipeline }
const pipelineCache = new WeakMap<GPUDevice, Pipelines>();

const pipelinesFor = (device: GPUDevice): Pipelines => {
  const cached = pipelineCache.get(device);
  if (cached) return cached;
  const create = (label: string, code: string, entryPoint: string) => {
    const module = device.createShaderModule({
      label: `${label} shader`, code: `${FILTER_FULLSCREEN_VERTEX_WGSL}\n${code}`
    });
    return device.createRenderPipeline({
      label, layout: 'auto', vertex: { module, entryPoint: 'filterFullscreenVertex' },
      fragment: { module, entryPoint, targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' }
    });
  };
  const pipelines = {
    horizontal: create('LightTable Wavelet Denoise horizontal',
      WAVELET_DENOISE_HORIZONTAL_WGSL, 'waveletHorizontal'),
    vertical: create('LightTable Wavelet Denoise vertical',
      WAVELET_DENOISE_VERTICAL_WGSL, 'waveletVertical')
  };
  pipelineCache.set(device, pipelines);
  return pipelines;
};

export class WaveletDenoiseCore {
  private readonly pool: FilterTargetPool;
  private scales: GPUBuffer[] = [];
  private readonly runtimes = new Map<string, Runtime>();
  private sampler: GPUSampler | null = null;

  constructor(private readonly device: GPUDevice) {
    this.pool = new FilterTargetPool(device, 3);
  }

  private ensureScales(): void {
    if (this.scales.length === STEPS.length) return;
    this.scales = STEPS.map((step, index) => {
      const buffer = this.device.createBuffer({
        label: `LightTable Wavelet Denoise scale ${index + 1}`,
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(buffer, 0, new Float32Array([step, index, 0, 0]));
      return buffer;
    });
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.pool.configure(width, height);
    this.sampler = sampler;
  }

  encode(encoder: GPUCommandEncoder, source: GPUTexture, request: {
    readonly key: string;
    readonly revision: number;
    readonly settings: P0FilterSettingsMap['reduce-noise'];
  }): GPUTexture {
    if (!this.sampler) throw new Error('WaveletDenoiseCore is not configured.');
    const authored = request.settings;
    if (authored.strength <= 0 && authored.reduceColorNoise <= 0 && authored.sharpenDetails <= 0) {
      return source;
    }
    let runtime = this.runtimes.get(request.key);
    if (!runtime) {
      runtime = {
        settings: this.device.createBuffer({
          label: `LightTable Wavelet Denoise settings: ${request.key}`,
          size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        }),
        revision: -1
      };
      this.runtimes.set(request.key, runtime);
    }
    if (runtime.revision !== request.revision) {
      this.device.queue.writeBuffer(runtime.settings, 0, new Float32Array([
        authored.strength / 10,
        authored.preserveDetails / 100,
        authored.reduceColorNoise / 100,
        authored.sharpenDetails / 100
      ]));
      runtime.revision = request.revision;
    }
    const pipelines = pipelinesFor(this.device);
    this.ensureScales();
    let current = source;
    for (let index = 0; index < STEPS.length; index += 1) {
      const horizontal = this.pool.acquire([current]);
      const output = this.pool.acquire([current, horizontal]);
      const horizontalGroup = this.device.createBindGroup({
        layout: pipelines.horizontal.getBindGroupLayout(0), entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.scales[index]! } }
        ]
      });
      const verticalGroup = this.device.createBindGroup({
        layout: pipelines.vertical.getBindGroupLayout(0), entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: horizontal.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: runtime.settings } },
          { binding: 4, resource: { buffer: this.scales[index]! } }
        ]
      });
      const encode = (pipeline: GPURenderPipeline, group: GPUBindGroup,
        target: GPUTexture, label: string) => {
        const pass = encoder.beginRenderPass({
          label,
          colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
      };
      encode(pipelines.horizontal, horizontalGroup, horizontal,
        `LightTable Reduce Noise scale ${index + 1} horizontal`);
      encode(pipelines.vertical, verticalGroup, output,
        `LightTable Reduce Noise scale ${index + 1} shrink`);
      current = output;
    }
    return current;
  }

  estimatedTextureBytes(): number { return this.pool.estimatedTextureBytes(); }

  destroy(): void {
    this.pool.destroy();
    for (const runtime of this.runtimes.values()) runtime.settings.destroy();
    this.runtimes.clear();
    for (const scale of this.scales) scale.destroy();
    this.scales = [];
    this.sampler = null;
  }
}
