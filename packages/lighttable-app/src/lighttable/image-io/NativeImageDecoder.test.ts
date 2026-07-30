import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeNativeImage } from './NativeImageDecoder';
import { WasmVipsDecoder } from './WasmVipsDecoder';

describe('LightTable native image decoder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the browser fast path and exposes the existing ingest contract', async () => {
    const close = vi.fn();
    const bitmap = { width: 1920, height: 1080, close } as unknown as ImageBitmap;
    const create = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', create);

    const result = await decodeNativeImage(new Blob(['image'], { type: 'image/jpeg' }));

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.any(Blob), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none'
    });
    expect(result.descriptor).toEqual({
      width: 1920,
      height: 1080,
      channels: 4,
      storage: 'external-image',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      orientationApplied: true,
      sourceBitDepth: 8,
      contentType: 'image/jpeg'
    });

    result.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes and rejects a decoded image without valid dimensions', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 0,
      height: 0,
      close
    }));

    await expect(decodeNativeImage(new Blob())).rejects.toThrow('no valid dimensions');
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the native fast path usable after advanced image I/O is unavailable', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    vi.stubGlobal('SharedArrayBuffer', undefined);
    vi.stubGlobal('Worker', undefined);

    await expect(new WasmVipsDecoder().decode(new Blob())).rejects.toThrow('unavailable');

    const close = vi.fn();
    const create = vi.fn().mockResolvedValue({
      width: 640,
      height: 480,
      close
    });
    vi.stubGlobal('createImageBitmap', create);

    const result = await decodeNativeImage(new Blob(['ordinary'], { type: 'image/jpeg' }));

    expect(result.descriptor).toMatchObject({ width: 640, height: 480, sourceBitDepth: 8 });
    expect(create).toHaveBeenCalledOnce();
    result.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
