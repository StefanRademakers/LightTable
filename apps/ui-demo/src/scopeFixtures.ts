import { observeScopeTheme, HUE_DISTRIBUTION_DISPLAY_WGSL, PARADE_SCOPE_DISPLAY_WGSL, VECTOR_SCOPE_DISPLAY_WGSL } from '@lighttable/ui/scopeRendering';
import type { VectorscopeRange } from '@lighttable/ui';

const vertex = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3))[index];
  var output: VertexOutput;
  output.position = vec4f(p, 0, 1);
  output.uv = p * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}`;

// Static post-analysis fixtures only. No editor imports or duplicated analysis engine.
function binsForPlot(plot: number, range: VectorscopeRange) {
  const bins = new Uint32Array(plot === 0 ? 256 : plot === 1 ? 3 * 65536 : 65536);
  if (plot === 0) {
    bins.forEach((_, x) => { bins[x] = 1200 * Math.exp(-1 * ((x - 28) / 12) ** 2) + 200 * Math.exp(-1 * ((x - 156) / 26) ** 2); });
  } else if (plot === 1) {
    for (let c = 0; c < 3; c++) for (let x = 0; x < 256; x++) for (let y = 0; y < 256; y++) {
      const mid = 100 + 48 * Math.sin(x / 60 + c) + c * 17;
      bins[c * 65536 + y * 256 + x] = 180 * Math.exp(-1 * ((y - mid) / (8 + x / 12)) ** 2);
    }
  } else {
    const extent = range === 'low' ? 0.4 : range === 'mid' ? 0.7 : range === 'high' ? 0.9 : 1;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const along = (y - 128) / 100;
      const center = 128 - along * 66;
      bins[y * 256 + x] = along >= 0 && along < extent ? 320 * Math.exp(-1 * ((x - center) / (3 + (1 - along) * 6)) ** 2) * (1 - along) : 0;
    }
  }
  return bins;
}

/** One-shot/on-resize presentation, no animation loop; all resources released on unmount. */
export function renderScopeFixtures(canvases: HTMLCanvasElement[], range: VectorscopeRange, onError: (error: string) => void) {
  let disposed = false;
  let device: GPUDevice | undefined;
  const buffers: GPUBuffer[] = [];
  const cleanups: Array<() => void> = [];
  const start = async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('WebGPU is unavailable for the scope demonstration.');
    const gpu = await adapter.requestDevice();
    if (disposed) { gpu.destroy(); return; }
    device = gpu;
    gpu.addEventListener('uncapturederror', event => { if (!disposed) onError(event.error.message); });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const shaders = [HUE_DISTRIBUTION_DISPLAY_WGSL, PARADE_SCOPE_DISPLAY_WGSL, VECTOR_SCOPE_DISPLAY_WGSL];
    for (const [index, canvas] of canvases.entries()) {
      const context = canvas.getContext('webgpu');
      if (!context) throw new Error('Could not create scope canvas.');
      context.configure({ device: gpu, format, alphaMode: 'opaque' });
      cleanups.push(() => context.unconfigure());
      const module = gpu.createShaderModule({ code: vertex + shaders[index] });
      const pipeline = gpu.createRenderPipeline({
        layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'main', targets: [{ format }] }
      });
      const bins = binsForPlot(index, range);
      const maximum = bins.reduce((max, value) => Math.max(max, value), 1);
      const makeBuffer = (data: Uint32Array | Float32Array, usage: number) => {
        const buffer = gpu.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
        buffers.push(buffer);
        gpu.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
        return buffer;
      };
      const values = makeBuffer(bins, GPUBufferUsage.STORAGE);
      const peak = makeBuffer(new Uint32Array([maximum]), GPUBufferUsage.STORAGE);
      const uniforms = makeBuffer(new Float32Array(8), GPUBufferUsage.UNIFORM);
      const bindGroup = gpu.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: values } }, { binding: 1, resource: { buffer: peak } }, { binding: 2, resource: { buffer: uniforms } }
      ] });
      const draw = () => {
        if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
        const encoder = gpu.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
        gpu.queue.submit([encoder.finish()]);
      };
      cleanups.push(observeScopeTheme(canvas, theme => {
        gpu.queue.writeBuffer(uniforms, 0, new Float32Array([1, 1, Number(theme.light), 0, ...theme.background, 1]));
        draw();
      }));
      const resize = new ResizeObserver(draw);
      resize.observe(canvas);
      cleanups.push(() => resize.disconnect());
    }
  };
  void start().catch(reason => { if (!disposed) onError(String(reason)); });
  return () => { disposed = true; cleanups.forEach(cleanup => cleanup()); buffers.forEach(buffer => buffer.destroy()); device?.destroy(); };
}
