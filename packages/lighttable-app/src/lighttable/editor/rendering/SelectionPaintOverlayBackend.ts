const SELECTION_PAINT_OVERLAY_WGSL = /* wgsl */ `
struct ViewUniforms {
  viewportWidth: f32, viewportHeight: f32,
  rectX: f32, rectY: f32, rectWidth: f32, rectHeight: f32,
  checkerSize: f32, padding: f32,
}
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
struct OverlayUniforms { colorOpacity: vec4f }
@group(0) @binding(0) var selectionMask: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;
@group(0) @binding(3) var<uniform> overlay: OverlayUniforms;

@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let viewportPixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (viewportPixel - vec2f(view.rectX, view.rectY)) / vec2f(view.rectWidth, view.rectHeight);
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) { return vec4f(0.0); }
  let coverage = textureSampleLevel(selectionMask, maskSampler, imageUv, 0.0).r;
  return vec4f(overlay.colorOpacity.rgb, clamp(coverage * overlay.colorOpacity.a, 0.0, 1.0));
}
`;

/** Presentation-only colored view of the authoritative selection coverage. */
export class SelectionPaintOverlayBackend {
  private readonly pipeline: GPURenderPipeline;
  private readonly settings: GPUBuffer;

  constructor(private readonly device: GPUDevice, format: GPUTextureFormat) {
    const module = device.createShaderModule({
      label: 'LightTable Selection Brush overlay shader',
      code: SELECTION_PAINT_OVERLAY_WGSL
    });
    this.pipeline = device.createRenderPipeline({
      label: 'LightTable Selection Brush overlay', layout: 'auto',
      vertex: { module, entryPoint: 'fullscreenVertex' },
      fragment: { module, entryPoint: 'main', targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }] },
      primitive: { topology: 'triangle-list' }
    });
    this.settings = device.createBuffer({
      label: 'LightTable Selection Brush overlay color',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    mask: GPUTexture,
    sampler: GPUSampler,
    viewBuffer: GPUBuffer,
    color: readonly [number, number, number]
  ) {
    this.device.queue.writeBuffer(this.settings, 0, new Float32Array([...color, 0.5]));
    const bindGroup = this.device.createBindGroup({
      label: 'LightTable Selection Brush overlay bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: mask.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: viewBuffer } },
        { binding: 3, resource: { buffer: this.settings } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable Selection Brush overlay',
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose() { this.settings.destroy(); }
}

export { SELECTION_PAINT_OVERLAY_WGSL };
