import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRgba8Texture } from './gpuReadback';
import { WebGpuEngine } from './WebGpuEngine';

const fixture = () => {
  const order: string[] = [];
  let resolve!: () => void, reject!: (reason: Error) => void;
  const mapping = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const bytes = new Uint8Array(512);
  bytes.set([1, 2, 3, 4, 5, 6, 7, 8]); bytes.set([9, 10, 11, 12, 13, 14, 15, 16], 256);
  const buffer = {
    mapState: 'unmapped',
    mapAsync: vi.fn(() => { order.push('map'); return mapping.then(() => { buffer.mapState = 'mapped'; }); }),
    getMappedRange: vi.fn(() => bytes.buffer),
    unmap: vi.fn(() => { buffer.mapState = 'unmapped'; }), destroy: vi.fn()
  };
  const encoder = { copyTextureToBuffer: vi.fn(), finish: vi.fn(() => ({})) };
  const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
  const outputTexture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
  const device = {
    createBuffer: vi.fn(() => buffer), createCommandEncoder: vi.fn(() => encoder),
    createTexture: vi.fn((_descriptor: GPUTextureDescriptor) => outputTexture), createBindGroup: vi.fn(() => ({})),
    queue: { submit: vi.fn(() => { order.push('submit'); }) }
  };
  const submitted = vi.fn(() => { order.push('callback'); });
  const read = (callback: (() => void) | undefined = submitted) => readRgba8Texture(
    device as unknown as GPUDevice, texture as unknown as GPUTexture, 2, 2, 'fixture', callback
  );
  return { order, resolve, reject, buffer, encoder, device, texture, outputTexture, submitted, read };
};
beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, COPY_SRC: 2 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe('RGBA8 readback submission handoff', () => {
  it('signals synchronously after the one queued copy and before mapping, not at completion', async () => {
    const f = fixture(), result = f.read();
    expect(f.order).toEqual(['submit', 'callback', 'map']);
    expect(f.buffer.destroy).not.toHaveBeenCalled();
    expect(f.encoder.copyTextureToBuffer).toHaveBeenCalledExactlyOnceWith(
      { texture: f.texture }, { buffer: f.buffer, bytesPerRow: 256, rowsPerImage: 2 }, [2, 2]
    );
    f.resolve();
    expect([...(await result)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(f.submitted).toHaveBeenCalledOnce();
    expect(f.device.queue.submit).toHaveBeenCalledOnce();
    expect(f.buffer.unmap).toHaveBeenCalledOnce();
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });

  it('keeps ordinary no-callback readback unchanged', async () => {
    const f = fixture();
    const result = readRgba8Texture(f.device as unknown as GPUDevice, f.texture as unknown as GPUTexture, 2, 2);
    expect(f.order).toEqual(['submit', 'map']); f.resolve();
    expect(await result).toHaveLength(16);
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });

  it.each(['submit', 'callback', 'map', 'map-sync', 'range'] as const)('rejects %s failures and releases its exact read buffer', async stage => {
    const f = fixture(), failure = new Error(`${stage} failed`);
    if (stage === 'submit') f.device.queue.submit.mockImplementation(() => { throw failure; });
    if (stage === 'callback') f.submitted.mockImplementation(() => { throw failure; });
    if (stage === 'map-sync') f.buffer.mapAsync.mockImplementation(() => { throw failure; });
    if (stage === 'range') f.buffer.getMappedRange.mockImplementation(() => { throw failure; });
    const result = f.read(), rejected = expect(result).rejects.toBe(failure);
    if (stage === 'map') f.reject(failure);
    else f.resolve();
    await rejected;
    expect(f.submitted).toHaveBeenCalledTimes(stage === 'submit' ? 0 : 1);
    expect(f.buffer.mapAsync).toHaveBeenCalledTimes(stage === 'submit' || stage === 'callback' ? 0 : 1);
    expect(f.buffer.unmap).toHaveBeenCalledTimes(stage === 'range' ? 1 : 0);
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });
});

const engineFixture = () => {
  const f = fixture();
  const engine = Object.assign(Object.create(WebGpuEngine.prototype), {
    metadata: { width: 2, height: 2 }, imageResources: { finalTexture: f.texture },
    displayPostTexture: f.texture, device: f.device,
    prepareDocumentExport: vi.fn(async () => () => undefined),
    precisionExportPipeline: { getBindGroupLayout: vi.fn(() => ({})) }, drawFullscreenPass: vi.fn()
  });
  return { ...f, engine };
};

describe('export submitted-copy dimensions', () => {
  it.each(['replace', 'clear'] as const)('returns original RGBA8 dimensions when the handoff %ss live renderer state', async change => {
    const f = engineFixture(), source = f.texture;
    const submitted = vi.fn(() => {
      f.engine.metadata = change === 'clear' ? null : { width: 90, height: 80 };
      f.engine.imageResources.finalTexture = null;
    });
    const result = f.engine.exportRgba8({ onReadbackSubmitted: submitted });
    await Promise.resolve();
    expect(submitted).toHaveBeenCalledOnce();
    expect(f.encoder.copyTextureToBuffer.mock.calls[0]?.[0]).toEqual({ texture: source });
    f.resolve();
    expect(await result).toEqual({ width: 2, height: 2, storage: 'u8',
      pixels: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) });
  });

  it('preserves captured RGBA16 dimensions through deferred mapping and releases its temporary texture', async () => {
    const f = engineFixture(), result = f.engine.exportRgba16();
    await Promise.resolve();
    expect(f.device.createTexture.mock.calls[0]?.[0]).toMatchObject({ size: [2, 2] });
    expect(f.buffer.mapAsync).toHaveBeenCalledOnce();
    f.engine.metadata = null; f.engine.displayPostTexture = null;
    f.resolve();
    expect(await result).toMatchObject({ width: 2, height: 2, storage: 'f16-display' });
    expect(f.outputTexture.destroy).toHaveBeenCalledOnce();
    expect(f.texture.destroy).not.toHaveBeenCalled();
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });

  it('does not signal a handoff if preparation or the final source assertion fails', async () => {
    for (const phase of ['prepare', 'assert'] as const) {
      const f = engineFixture(), failure = new Error(phase);
      f.engine.prepareDocumentExport.mockImplementation(async () => {
        if (phase === 'prepare') throw failure;
        return () => { throw failure; };
      });
      await expect(f.engine.exportRgba8({ onReadbackSubmitted: f.submitted })).rejects.toBe(failure);
      expect(f.submitted).not.toHaveBeenCalled();
      expect(f.device.createBuffer).not.toHaveBeenCalled();
    }
  });
});
