const SELECTION_CONTOUR_WGSL = /* wgsl */ `
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

struct AntUniforms {
  phasePadding: vec4f,
}

@group(0) @binding(0) var selectionMask: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewUniforms;
@group(0) @binding(3) var<uniform> ants: AntUniforms;

@vertex
fn fullscreenVertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

fn maskAt(imageUv: vec2f) -> f32 {
  let sampled = textureSampleLevel(
    selectionMask,
    maskSampler,
    clamp(imageUv, vec2f(0.0), vec2f(1.0)),
    0.0
  ).r;
  let outside = any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0));
  return select(sampled, 0.0, outside);
}

fn contourCoverage(imageUv: vec2f, radiusPx: f32) -> f32 {
  let offset = vec2f(
    radiusPx / max(view.rectWidth, 1.0),
    radiusPx / max(view.rectHeight, 1.0)
  );
  let center = maskAt(imageUv);
  let left = maskAt(imageUv - vec2f(offset.x, 0.0));
  let right = maskAt(imageUv + vec2f(offset.x, 0.0));
  let up = maskAt(imageUv - vec2f(0.0, offset.y));
  let down = maskAt(imageUv + vec2f(0.0, offset.y));
  let low = min(center, min(min(left, right), min(up, down)));
  let high = max(center, max(max(left, right), max(up, down)));
  let crossesThreshold = select(0.0, 1.0, low <= 0.5 && high >= 0.5);
  return crossesThreshold * smoothstep(0.015, 0.20, high - low);
}

@fragment
fn main(input: VertexOutput) -> @location(0) vec4f {
  let viewportPixel = input.uv * vec2f(view.viewportWidth, view.viewportHeight);
  let imageUv = (
    viewportPixel - vec2f(view.rectX, view.rectY)
  ) / vec2f(view.rectWidth, view.rectHeight);
  if (any(imageUv < vec2f(0.0)) || any(imageUv > vec2f(1.0))) {
    return vec4f(0.0);
  }

  let underlay = contourCoverage(imageUv, 1.65);
  let line = contourCoverage(imageUv, 0.85);
  if (underlay <= 0.0) {
    return vec4f(0.0);
  }

  // Screen-space marching ants stay one device pixel wide at every zoom.
  let dash = ((u32(floor(viewportPixel.x + viewportPixel.y + ants.phasePadding.x)) / 4u) & 1u) == 0u;
  let lineColor = select(vec3f(0.07), vec3f(1.0), dash);
  let color = mix(vec3f(0.055), lineColor, line);
  return vec4f(color, max(underlay * 0.88, line * 0.98));
}
`;

/**
 * Draws the authoritative selection mask's 0.5 iso-contour directly into the
 * viewport. It owns no selection state and performs no CPU readback.
 */
export class SelectionContourOverlayBackend {
  private readonly pipeline: GPURenderPipeline;
  private readonly antsBuffer: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat
  ) {
    const module = device.createShaderModule({
      label: 'LightTable selection contour overlay shader',
      code: SELECTION_CONTOUR_WGSL
    });
    this.pipeline = device.createRenderPipeline({
      label: 'LightTable selection contour overlay',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'fullscreenVertex'
      },
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
    this.antsBuffer = device.createBuffer({
      label: 'LightTable selection ants phase',
      size: 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    mask: GPUTexture,
    sampler: GPUSampler,
    viewBuffer: GPUBuffer,
    phasePx = 0
  ) {
    this.device.queue.writeBuffer(
      this.antsBuffer,
      0,
      new Float32Array([phasePx, 0, 0, 0])
    );
    const bindGroup = this.device.createBindGroup({
      label: 'LightTable selection contour overlay bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: mask.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: viewBuffer } },
        { binding: 3, resource: { buffer: this.antsBuffer } }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable selection contour overlay',
      colorAttachments: [{
        view: target,
        loadOp: 'load',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose() {
    this.antsBuffer.destroy();
  }
}

export { SELECTION_CONTOUR_WGSL };
