export interface FullscreenPassOptions {
  label?: string;
  clearValue?: GPUColor;
}

/**
 * Encodes the common full-canvas triangle pass used by LightTable's GPU
 * processing stages. Keeping this command shape shared prevents individual
 * renderers from quietly diverging in load/store or clear behavior.
 */
export const encodeFullscreenPass = (
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  target: GPUTextureView,
  options: FullscreenPassOptions = {}
): void => {
  const pass = encoder.beginRenderPass({
    label: options.label,
    colorAttachments: [{
      view: target,
      clearValue: options.clearValue ?? { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
};
