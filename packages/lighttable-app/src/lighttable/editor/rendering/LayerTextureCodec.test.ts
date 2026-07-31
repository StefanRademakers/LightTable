import { describe, expect, it } from 'vitest';
import { layerPngReadbackLayout } from './LayerTextureCodec';

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
