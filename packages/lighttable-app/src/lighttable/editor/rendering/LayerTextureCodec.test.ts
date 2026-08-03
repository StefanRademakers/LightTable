import { describe, expect, it } from 'vitest';
import { layerPngReadbackLayout, rawRgba8UploadLayout } from './LayerTextureCodec';

describe('layerPngReadbackLayout', () => {
  it('aligns rows for WebGPU copies without changing image dimensions', () => {
    expect(layerPngReadbackLayout(80, 45)).toEqual({
      width: 80,
      height: 45,
      bytesPerRow: 512,
      byteLength: 23_040
    });
  });

  it('keeps zero-sized transient requests valid for GPU allocation', () => {
    expect(layerPngReadbackLayout(0, 0)).toEqual({
      width: 1,
      height: 1,
      bytesPerRow: 256,
      byteLength: 256
    });
  });
});

describe('rawRgba8UploadLayout', () => {
  it('accepts exact layer-local RGBA8 payloads without PNG row padding', () => {
    expect(rawRgba8UploadLayout(12 * 7 * 4, 12, 7)).toEqual({
      bytesPerRow: 48,
      rowsPerImage: 7
    });
  });

  it('rejects truncated or dimensionless transient payloads', () => {
    expect(() => rawRgba8UploadLayout(12 * 7 * 4 - 1, 12, 7))
      .toThrow('does not match its layer-local dimensions');
    expect(() => rawRgba8UploadLayout(0, 0, 7))
      .toThrow('does not match its layer-local dimensions');
  });
});
