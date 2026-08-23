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
  const directInteropOk = close(corner, expectedCorner) && close(center, expectedCenter);

  const paintSceneTexture = device.createTexture({
    label: 'LightTable serialized paint-scene texture',
    size: [width, height, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.STORAGE_BINDING,
  });
  const paintScene = {
    schemaVersion: 1,
    sourceId: 'interop-fixture',
    sourceRevision: '1',
    fragments: [{
      stableId: 'rect',
      revisionKey: '1:0:0',
      paths: [{
        stableId: 'rect:path',
        revisionKey: '1',
        commands: [
          { kind: 'move', x: 8, y: 8 },
          { kind: 'line', x: 56, y: 8 },
          { kind: 'line', x: 56, y: 56 },
          { kind: 'line', x: 8, y: 56 },
          { kind: 'close' },
        ],
      }],
      commands: [{
        kind: 'fill-path',
        pathId: 'rect:path',
        fillRule: 'nonzero',
        transform: [1, 0, 0, 1, 0, 0],
        color: [1, 0.25, 0, 1],
      }],
    }],
  };
  if (!interop.render_paint_scene_texture(
    paintSceneTexture,
    width,
    height,
    JSON.stringify(paintScene),
  )) {
    throw new Error('Rust rejected the serialized paint-scene texture');
  }
  await device.queue.onSubmittedWorkDone();
  const sceneReadback = device.createBuffer({
    label: 'LightTable paint-scene readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const sceneEncoder = device.createCommandEncoder();
  sceneEncoder.copyTextureToBuffer(
    { texture: paintSceneTexture },
    { buffer: sceneReadback, bytesPerRow, rowsPerImage: height },
    [width, height, 1],
  );
  device.queue.submit([sceneEncoder.finish()]);
  await sceneReadback.mapAsync(GPUMapMode.READ);
  const sceneBytes = new Uint8Array(sceneReadback.getMappedRange());
  const sceneCorner = [...sceneBytes.slice(0, 4)];
  const sceneCenter = [...sceneBytes.slice(centerOffset, centerOffset + 4)];
  sceneReadback.unmap();
  const expectedSceneCorner = [0, 0, 0, 0];
  const expectedSceneCenter = [255, 64, 0, 255];
  const paintSceneOk = close(sceneCorner, expectedSceneCorner)
    && close(sceneCenter, expectedSceneCenter);
  const ok = directInteropOk && paintSceneOk;
  globalThis.__interopResult = {
    ok, directInteropOk, corner, expectedCorner, center, expectedCenter,
    paintSceneOk, sceneCorner, expectedSceneCorner, sceneCenter, expectedSceneCenter,
  };
  console.log(`${ok ? 'INTEROP_PASS' : 'INTEROP_FAIL'} ${JSON.stringify(globalThis.__interopResult)}`);
} catch (error) {
  fail(error);
}
