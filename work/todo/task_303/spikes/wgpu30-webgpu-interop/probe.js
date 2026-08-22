import init, { InteropDevice } from './pkg/interop.js';

const fail = (error) => {
  console.error(`INTEROP_FAIL ${error?.stack ?? error}`);
  globalThis.__interopResult = { ok: false, error: String(error) };
};

try {
  await init();
  const interop = await InteropDevice.create();
  const device = interop.device_handle();
  const width = 64;
  const height = 64;
  const texture = device.createTexture({
    label: 'LightTable JS-owned interop texture',
    size: [width, height, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.STORAGE_BINDING,
  });

  if (!interop.render_vello_texture(texture, width, height)) {
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
  const bytes = new Uint8Array(readback.getMappedRange());
  const corner = [...bytes.slice(0, 4)];
  const centerOffset = 32 * bytesPerRow + 32 * 4;
  const center = [...bytes.slice(centerOffset, centerOffset + 4)];
  readback.unmap();

  const expectedCorner = [8, 16, 24, 255];
  const expectedCenter = [242, 140, 168, 255];
  const close = (actual, expected) =>
    actual.every((value, index) => Math.abs(value - expected[index]) <= 1);
  const ok = close(corner, expectedCorner) && close(center, expectedCenter);
  globalThis.__interopResult = { ok, corner, expectedCorner, center, expectedCenter };
  console.log(`${ok ? 'INTEROP_PASS' : 'INTEROP_FAIL'} ${JSON.stringify(globalThis.__interopResult)}`);
} catch (error) {
  fail(error);
}
