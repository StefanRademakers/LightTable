import { beforeEach, describe, expect, it, vi } from 'vitest';

const close = vi.fn();
vi.mock('../image-io/NativeImageDecoder', () => ({
  decodeNativeImage: vi.fn(async () => ({
    kind: 'native-bitmap',
    bitmap: { width: 12, height: 8 },
    descriptor: {
      width: 12,
      height: 8,
      channels: 4,
      storage: 'external-image',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      alphaMode: 'straight',
      orientationApplied: true,
      sourceBitDepth: 8,
      contentType: 'image/png'
    },
    close
  }))
}));

import { DocumentSourceGpuLoader } from './documentSourceGpuLoader';

describe('DocumentSourceGpuLoader native provenance', () => {
  beforeEach(() => {
    close.mockClear();
    Object.defineProperty(globalThis, 'GPUTextureUsage', {
      configurable: true,
      value: { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 }
    });
  });

  it('retains the decoder bit depth and source format on the fast path', async () => {
    const texture = {} as GPUTexture;
    const device = {
      createTexture: vi.fn(() => texture),
      queue: { copyExternalImageToTexture: vi.fn() }
    } as unknown as GPUDevice;
    const loader = new DocumentSourceGpuLoader(device, {} as GPURenderPipeline);
    const loaded = await loader.load(new Blob([], { type: 'image/png' }), 'source.png');
    expect(loaded.metadata).toMatchObject({
      decoder: 'browser',
      sourceBitDepth: 8,
      sourceFormat: 'PNG',
      sourceInterpretation: '8-bit RGBA sRGB'
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
