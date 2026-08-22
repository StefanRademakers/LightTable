export interface VectorMaskCompositeSurface {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  dispose(): void;
}

export const VECTOR_MASK_COMPOSITE_WGSL = /* wgsl */`
struct VertexOutput {
  @builtin(position) position: vec4f,
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  return output;
}

@group(0) @binding(0) var contentTexture: texture_2d<f32>;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let coordinate = vec2i(input.position.xy);
  let content = textureLoad(contentTexture, coordinate, 0);
  let coverage = textureLoad(maskTexture, coordinate, 0).a;
  return content * coverage;
}
`;

/** Multiplies premultiplied vector content by a document-sized vector mask. */
export class VectorMaskCompositeBackend {
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly layout: GPUBindGroupLayout;

  constructor(private readonly device: GPUDevice) {
    this.layout = device.createBindGroupLayout({
      label: 'LightTable vector mask composite layout',
      entries: [0, 1].map(binding => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' as const }
      }))
    });
  }

  createSurface(
    width: number,
    height: number,
    format: GPUTextureFormat = 'rgba16float'
  ): VectorMaskCompositeSurface {
    const texture = this.device.createTexture({
      label: 'LightTable clipped vector surface',
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    let disposed = false;
    return {
      texture, view: texture.createView(), width, height, format,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        texture.destroy();
      }
    };
  }

  encode(
    encoder: GPUCommandEncoder,
    content: GPUTexture,
    mask: GPUTexture,
    target: VectorMaskCompositeSurface
  ) {
    const pipeline = this.pipeline(target.format);
    const bindGroup = this.device.createBindGroup({
      label: 'LightTable vector mask composite bind group',
      layout: this.layout,
      entries: [
        { binding: 0, resource: content.createView() },
        { binding: 1, resource: mask.createView() }
      ]
    });
    const pass = encoder.beginRenderPass({
      label: 'LightTable vector mask composite',
      colorAttachments: [{
        view: target.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear', storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  dispose() {
    this.pipelines.clear();
  }

  private pipeline(format: GPUTextureFormat) {
    const cached = this.pipelines.get(format);
    if (cached) return cached;
    const module = this.device.createShaderModule({
      label: 'LightTable vector mask composite shader',
      code: VECTOR_MASK_COMPOSITE_WGSL
    });
    const pipeline = this.device.createRenderPipeline({
      label: 'LightTable vector mask composite pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });
    this.pipelines.set(format, pipeline);
    return pipeline;
  }
}
