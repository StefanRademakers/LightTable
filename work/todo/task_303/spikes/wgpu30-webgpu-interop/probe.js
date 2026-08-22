import init, { InteropDevice } from './pkg/interop.js';

const fail = (error) => {
  console.error(`INTEROP_FAIL ${error?.stack ?? error}`);
  globalThis.__interopResult = { ok: false, error: String(error) };
};

try {
  await init();
  const interop = await InteropDevice.create();
  const device = interop.device_handle();
  const width = 4;
  const height = 4;
  const texture = device.createTexture({
    label: 'LightTable JS-owned interop texture',
    size: [width, height, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });

  if (!interop.wrap_texture(texture, width, height)) {
    throw new Error('Rust rejected the foreign texture dimensions');
  }
  await device.queue.onSubmittedWorkDone();

  const bytesPerRow = 256;
  const readback = device.createBuffer({
    label: 'LightTable interop readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readback, bytesPerRow, rowsPerImage: height },
    [width, height, 1],
  );
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const pixel = [...new Uint8Array(readback.getMappedRange()).slice(0, 4)];
  readback.unmap();

  const expected = [32, 128, 223, 255];
  const ok = pixel.every((value, index) => Math.abs(value - expected[index]) <= 1);
  globalThis.__interopResult = { ok, pixel, expected };
  console.log(`${ok ? 'INTEROP_PASS' : 'INTEROP_FAIL'} ${JSON.stringify(globalThis.__interopResult)}`);
} catch (error) {
  fail(error);
}

