import type { RasterSelectionMask } from '../selection/selectionTypes';

const SMART_SELECTION_OVERLAY_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32,
  viewportHeight: f32,
  rectX: f32,
  rectY: f32,
  rectWidth: f32,
  rectHeight: f32,
  checkerSize: f32,
  padding: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var candidateMask: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;

@vertex
fn fullscreenVertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)
  );
  let uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

fn maskAt(imageUv: vec2f) -> f32 {
  let outside = any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0));
  return select(textureSampleLevel(candidateMask, maskSampler, clamp(imageUv, vec2f(0.0), vec2f(1.0)), 0.0).r, 0.0, outside);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let viewportPixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (viewportPixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) { return vec4f(0.0); }

  let coverage = maskAt(imageUv);
  if (coverage <= 0.002) { return vec4f(0.0); }
  let offset = vec2f(1.25 / max(view.rectWidth, 1.0), 1.25 / max(view.rectHeight, 1.0));
  let low = min(coverage, min(
    min(maskAt(imageUv - vec2f(offset.x, 0.0)), maskAt(imageUv + vec2f(offset.x, 0.0))),
    min(maskAt(imageUv - vec2f(0.0, offset.y)), maskAt(imageUv + vec2f(0.0, offset.y)))
  ));
  let edge = smoothstep(0.04, 0.30, coverage - low);
  let alpha = mix(0.10, 0.30, clamp(coverage, 0.0, 1.0)) + edge * 0.35;
  return vec4f(vec3f(0.10, 0.56, 1.0), alpha);
}
`;

/** GPU-only transient candidate preview; it never owns persistent selection state. */
export class SmartSelectionOverlayBackend {
  private readonly pipeline: GPURenderPipeline;
  private texture: GPUTexture | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly device: GPUDevice, format: GPUTextureFormat) {
    const module = device.createShaderModule({
      label: 'LightTable smart selection preview shader',
      code: SMART_SELECTION_OVERLAY_WGSL
    });
    this.pipeline = device.createRenderPipeline({
      label: 'LightTable smart selection preview',
      layout: 'auto',
      vertex: { module, entryPoint: 'fullscreenVertex' },
      fragment: {
        module,
        entryPoint: 'main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  get visible() { return this.texture !== null; }

  setMask(mask: RasterSelectionMask | null) {
    if (!mask) {
      this.texture?.destroy();
      this.texture = null;
      this.width = 0;
      this.height = 0;
      return;
    }
    if (!this.texture || this.width !== mask.width || this.height !== mask.height) {
      this.texture?.destroy();
      this.texture = this.device.createTexture({
        label: 'LightTable smart selection preview mask',
        size: [mask.width, mask.height],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.width = mask.width;
      this.height = mask.height;
    }
    this.device.queue.writeTexture(
      { texture: this.texture },
      mask.data,
      { bytesPerRow: mask.width, rowsPerImage: mask.height },
      [mask.width, mask.height]
    );
  }

  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    sampler: GPUSampler,
    viewBuffer: GPUBuffer
  ) {
    if (!this.texture) return;
    const bindGroup = this.device.createBindGroup({
      label: 'LightTable smart selection preview bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: viewBuffer } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable smart selection preview',
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose() {
    this.texture?.destroy();
    this.texture = null;
  }
}

export { SMART_SELECTION_OVERLAY_WGSL };
