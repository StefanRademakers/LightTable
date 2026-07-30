import { describe, expect, it } from 'vitest';
import { psdCompositeToPreviewPixels } from './psdPixelConversion';

describe('PSD composite preview conversion', () => {
  it('copies 8-bit pixels without changing channel values', () => {
    expect([...psdCompositeToPreviewPixels(
      new Uint8ClampedArray([1, 64, 128, 255]),
      8
    )]).toEqual([1, 64, 128, 255]);
  });

  it('maps the complete 16-bit range to the complete 8-bit range', () => {
    expect([...psdCompositeToPreviewPixels(
      new Uint16Array([0, 32768, 65535, 65535]),
      16
    )]).toEqual([0, 128, 255, 255]);
  });

  it('encodes linear 32-bit RGB while leaving alpha linear', () => {
    expect([...psdCompositeToPreviewPixels(
      new Float32Array([0, 0.0031308, 1, 0.5]),
      32
    )]).toEqual([0, 10, 255, 128]);
  });
});

