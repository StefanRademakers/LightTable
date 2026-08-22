import init, { InteropDevice } from './pkg/interop.js';
import type { PaintScene, PaintScenePathCommand } from '@lighttable/paint-scene';
import { PAINT_SCENE_SCHEMA_VERSION } from '@lighttable/paint-scene';
import { PaintSceneWebGpuBackend } from '@lighttable/vector-webgpu';

const width = 512;
const height = 512;
const bytesPerRow = Math.ceil(width * 4 / 256) * 256;

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

const distribution = (values: readonly number[]) => ({
  samples: values,
  min: Math.min(...values),
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: Math.max(...values)
});

const circleCommands = (radius: number): readonly PaintScenePathCommand[] => {
  const k = radius * 0.5522847498307936;
  return [
    { kind: 'move', x: radius, y: 0 },
    { kind: 'cubic', control1X: radius, control1Y: k, control2X: k, control2Y: radius, x: 0, y: radius },
    { kind: 'cubic', control1X: -k, control1Y: radius, control2X: -radius, control2Y: k, x: -radius, y: 0 },
    { kind: 'cubic', control1X: -radius, control1Y: -k, control2X: -k, control2Y: -radius, x: 0, y: -radius },
    { kind: 'cubic', control1X: k, control1Y: -radius, control2X: radius, control2Y: -k, x: radius, y: 0 },
    { kind: 'close' }
  ];
};

const createScene = (
  columns = 16,
  rows = 16,
  options: { fillAlpha?: number; stroke?: boolean } = {}
): PaintScene => ({
  schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
  sourceId: 'backend-bakeoff',
  sourceRevision: '1',
  fragments: Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const stableId = `circle-${index}`;
    const pathId = `${stableId}:path`;
    const commands: PaintScene['fragments'][number]['commands'][number][] = [{
      kind: 'fill-path', pathId, fillRule: 'nonzero',
      transform: [1, 0, 0, 1, 16 + column * 32, 16 + row * 32],
      color: [0.12 + column / 24, 0.15 + row / 24, 0.8, options.fillAlpha ?? 0.9]
    }];
    if (options.stroke ?? true) commands.push({
      kind: 'stroke-path', pathId,
      transform: [1, 0, 0, 1, 16 + column * 32, 16 + row * 32],
      color: [0.95, 0.85, 0.1, 1],
      stroke: { width: 1.5, cap: 'round', join: 'round', miterLimit: 4, dash: [], dashOffset: 0 }
    });
    return {
      stableId,
      revisionKey: '1:0:0',
      paths: [{ stableId: pathId, revisionKey: '1', commands: circleCommands(10) }],
      commands
    };
  })
});

const texture = (device: GPUDevice, label: string) => device.createTexture({
  label,
  size: [width, height, 1],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING
});

const readTexture = async (device: GPUDevice, source: GPUTexture) => {
  const output = device.createBuffer({
    label: 'Bake-off readback', size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture: source },
    { buffer: output, bytesPerRow, rowsPerImage: height },
    [width, height, 1]
  );
  device.queue.submit([encoder.finish()]);
  await output.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(output.getMappedRange());
  const packed = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    packed.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
  }
  output.unmap();
  output.destroy();
  return packed;
};

const compare = (left: Uint8Array, right: Uint8Array) => {
  let squared = 0;
  let changed = 0;
  let alphaOccupancyMismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    squared += delta * delta;
    if (Math.abs(delta) > 2) changed += 1;
    if (index % 4 === 3 && (left[index] > 0) !== (right[index] > 0)) alphaOccupancyMismatch += 1;
  }
  return {
    rmse: Math.sqrt(squared / left.length),
    changedChannelRatio: changed / left.length,
    alphaOccupancyMismatchRatio: alphaOccupancyMismatch / (left.length / 4)
  };
};

const pixelAt = (bytes: Uint8Array, x: number, y: number) =>
  [...bytes.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

const fail = (error: unknown) => {
  console.error(`BAKEOFF_FAIL ${JSON.stringify({ error: error instanceof Error ? error.stack : String(error) })}`);
};

try {
  await init();
  const interop = await InteropDevice.create();
  const device = interop.device_handle() as GPUDevice;
  const scene = createScene();
  const serializeStarted = performance.now();
  const serialized = JSON.stringify(scene);
  const serializeMs = performance.now() - serializeStarted;
  console.log('BAKEOFF_PHASE baseline');
  const current = new PaintSceneWebGpuBackend(device);
  const currentSurface = current.createSurface(width, height, 'rgba8unorm', true);
  const currentCalls: number[] = [];
  const currentGpu: number[] = [];
  let currentCounts = null;
  for (let run = 0; run < 6; run += 1) {
    const encoder = device.createCommandEncoder();
    const clear = encoder.beginRenderPass({
      colorAttachments: [{
        view: currentSurface.renderColorView,
        resolveTarget: currentSurface.sampleCount > 1 ? currentSurface.colorView : undefined,
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    clear.end();
    const callStarted = performance.now();
    currentCounts = current.encode(encoder, scene, {
      colorView: currentSurface.renderColorView,
      resolveView: currentSurface.sampleCount > 1 ? currentSurface.colorView : null,
      stencilView: currentSurface.stencilView,
      format: currentSurface.format,
      sampleCount: currentSurface.sampleCount,
      origin: { x: 0, y: 0 }, width, height
    });
    currentCalls.push(performance.now() - callStarted);
    const gpuStarted = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    currentGpu.push(performance.now() - gpuStarted);
    await current.notifySubmitted();
  }
  console.log('BAKEOFF_PHASE current');

  const velloTexture = texture(device, 'Vello bake-off target');
  const velloCalls: number[] = [];
  const velloGpu: number[] = [];
  for (let run = 0; run < 6; run += 1) {
    const callStarted = performance.now();
    interop.render_paint_scene_texture(velloTexture, width, height, serialized);
    velloCalls.push(performance.now() - callStarted);
    const gpuStarted = performance.now();
    await device.queue.onSubmittedWorkDone();
    velloGpu.push(performance.now() - gpuStarted);
  }
  console.log('BAKEOFF_PHASE vello');

  const currentPixels = await readTexture(device, currentSurface.color);
  const velloPixels = await readTexture(device, velloTexture);
  const pixels = compare(currentPixels, velloPixels);
  const renderParityCase = async (caseScene: PaintScene) => {
    const encoder = device.createCommandEncoder();
    const clear = encoder.beginRenderPass({
      colorAttachments: [{
        view: currentSurface.renderColorView,
        resolveTarget: currentSurface.sampleCount > 1 ? currentSurface.colorView : undefined,
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    clear.end();
    current.encode(encoder, caseScene, {
      colorView: currentSurface.renderColorView,
      resolveView: currentSurface.sampleCount > 1 ? currentSurface.colorView : null,
      stencilView: currentSurface.stencilView,
      format: currentSurface.format,
      sampleCount: currentSurface.sampleCount,
      origin: { x: 0, y: 0 }, width, height
    });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await current.notifySubmitted();
    interop.render_paint_scene_texture(velloTexture, width, height, JSON.stringify(caseScene));
    await device.queue.onSubmittedWorkDone();
    const currentCasePixels = await readTexture(device, currentSurface.color);
    const velloCasePixels = await readTexture(device, velloTexture);
    return {
      difference: compare(currentCasePixels, velloCasePixels),
      center: {
        current: pixelAt(currentCasePixels, 16, 16),
        vello: pixelAt(velloCasePixels, 16, 16)
      },
      edge: {
        current: pixelAt(currentCasePixels, 26, 16),
        vello: pixelAt(velloCasePixels, 26, 16)
      }
    };
  };
  const parityCases = {
    opaqueFill: await renderParityCase(createScene(4, 4, { fillAlpha: 1, stroke: false })),
    alphaFill: await renderParityCase(createScene(4, 4, { fillAlpha: 0.5, stroke: false })),
    opaqueFillStroke: await renderParityCase(createScene(4, 4, { fillAlpha: 1, stroke: true }))
  };
  const report = {
    scene: {
      fragments: scene.fragments.length,
      paths: scene.fragments.reduce((sum, fragment) => sum + fragment.paths.length, 0),
      commands: scene.fragments.reduce((sum, fragment) => sum + fragment.commands.length, 0),
      serializedBytes: new TextEncoder().encode(serialized).byteLength,
      serializeMs
    },
    current: {
      callMs: distribution(currentCalls), gpuCompletionMs: distribution(currentGpu),
      cache: current.metrics(), counts: currentCounts
    },
    vello: { callMs: distribution(velloCalls), gpuCompletionMs: distribution(velloGpu) },
    pixels,
    samples: {
      center: { current: pixelAt(currentPixels, 16, 16), vello: pixelAt(velloPixels, 16, 16) },
      edge: { current: pixelAt(currentPixels, 26, 16), vello: pixelAt(velloPixels, 26, 16) }
    },
    parityCases,
    jsHeapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
  };
  const structurallyCorrect = pixels.alphaOccupancyMismatchRatio < 0.02 && pixels.rmse < 20;
  console.log(`BAKEOFF_${structurallyCorrect ? 'PASS' : 'FAIL'} ${JSON.stringify(report)}`);
} catch (error) {
  fail(error);
}
