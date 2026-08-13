import { describe, expect, it } from 'vitest';
import {
  alignGpuBytesPerRow,
  selectionMaskToRgba8,
  stripTextureRowPadding
} from './gpuReadback';

describe('GPU readback layout', () => {
  it('aligns texture copy rows to WebGPU requirements', () => {
    expect(alignGpuBytesPerRow(0)).toBe(0);
    expect(alignGpuBytesPerRow(4)).toBe(256);
    expect(alignGpuBytesPerRow(256)).toBe(256);
    expect(alignGpuBytesPerRow(257)).toBe(512);
  });

  it('removes per-row GPU padding without changing pixel order', () => {
    const mapped = new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 90, 91, 92, 93,
      9, 10, 11, 12, 13, 14, 15, 16, 94, 95, 96, 97
    ]);

    const pixels = stripTextureRowPadding(mapped, 2, 2, 4, 12);

    expect([...pixels]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
      9, 10, 11, 12, 13, 14, 15, 16
    ]);
  });

  it('supports tightly packed rows for host-native readback paths', () => {
    const mapped = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    expect([...stripTextureRowPadding(mapped, 1, 2, 4, 4)]).toEqual([...mapped]);
  });

  it('encodes selection coverage as opaque grayscale pixels', () => {
    expect([...selectionMaskToRgba8(new Uint8Array([0, 127, 255]))]).toEqual([
      0, 0, 0, 255,
      127, 127, 127, 255,
      255, 255, 255, 255
    ]);
  });
});
