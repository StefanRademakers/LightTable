const documentTextureUsage = () =>
  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

export const COVERAGE_TEXTURE_FORMAT: GPUTextureFormat = 'r16float';
export const LAYER_MASK_TEXTURE_FORMAT = COVERAGE_TEXTURE_FORMAT;
export const SELECTION_TEXTURE_FORMAT = COVERAGE_TEXTURE_FORMAT;

interface DocumentTextureFactoryOptions {
  device: GPUDevice;
  dimensions: () => { width: number; height: number };
}

/**
 * Centralizes document-sized texture allocation and the two primitive render
 * operations shared by editor GPU services. Higher-level services request a
 * semantic texture type without owning formats, usages or canvas dimensions.
 */
export class DocumentTextureFactory {
  constructor(private readonly options: DocumentTextureFactoryOptions) {}

  createColor(label: string) {
    return this.create(label, 'rgba16float');
  }

  createColorSized(label: string, width: number, height: number) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('Texture dimensions must be positive integers.');
    }
    return this.options.device.createTexture({
      label,
      size: [width, height],
      format: 'rgba16float',
      usage: documentTextureUsage()
    });
  }

  /** High-precision ROI intermediate for height derivatives and normals. */
  createFloatColorSized(label: string, width: number, height: number) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('Texture dimensions must be positive integers.');
    }
    return this.options.device.createTexture({
      label,
      size: [width, height],
      format: 'rgba32float',
      usage: documentTextureUsage()
    });
  }

  createMask(label: string) {
    const texture = this.create(label, LAYER_MASK_TEXTURE_FORMAT);
    const encoder = this.options.device.createCommandEncoder({
      label: `Initialize ${label}`
    });
    this.clear(encoder, texture, { r: 1, g: 1, b: 1, a: 1 });
    this.options.device.queue.submit([encoder.finish()]);
    return texture;
  }

  createMaskSized(label: string, width: number, height: number) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('Texture dimensions must be positive integers.');
    }
    return this.options.device.createTexture({
      label,
      size: [width, height],
      format: LAYER_MASK_TEXTURE_FORMAT,
      usage: documentTextureUsage()
    });
  }

  createSelection(label: string) {
    return this.create(label, SELECTION_TEXTURE_FORMAT);
  }

  createByteCoverageSized(label: string, width: number, height: number) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('Texture dimensions must be positive integers.');
    }
    return this.options.device.createTexture({
      label,
      size: [width, height],
      format: 'r8unorm',
      usage: documentTextureUsage()
    });
  }

  initializeSelectionTargets(mask: GPUTexture, result: GPUTexture, shape: GPUTexture) {
    const encoder = this.options.device.createCommandEncoder({
      label: 'Initialize LightTable selection'
    });
    const selected = { r: 1, g: 0, b: 0, a: 1 };
    this.clear(encoder, mask, selected);
    this.clear(encoder, result, selected);
    this.clear(encoder, shape);
    this.options.device.queue.submit([encoder.finish()]);
  }

  clear(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    clearValue: GPUColor = { r: 0, g: 0, b: 0, a: 0 }
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        clearValue,
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.end();
  }

  drawFullscreen(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target,
        clearValue,
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private create(label: string, format: GPUTextureFormat) {
    const { width, height } = this.options.dimensions();
    return this.options.device.createTexture({
      label,
      size: [Math.max(1, width), Math.max(1, height)],
      format,
      usage: documentTextureUsage()
    });
  }
}
