import { describe, expect, it } from 'vitest';
import type { HbGpuFixtureGlyph, PackedCoverageAtlas } from '@lighttable/text-rendering';
import { padR8TextureRows } from './CoverageAtlasPrototype';
import { buildHbGpuVertices } from './HbGpuPrototype';

describe('bounded text WebGPU prototype data', () => {
  it('pads R8 uploads to WebGPU row alignment without changing pixels', () => {
    const atlas: PackedCoverageAtlas = {
      width: 3, height: 2, pixels: new Uint8Array([1, 2, 3, 4, 5, 6]), entries: [], occupiedBytes: 6
    };
    const padded = padR8TextureRows(atlas);
    expect(padded.bytesPerRow).toBe(256);
    expect(padded.data.byteLength).toBe(512);
    expect([...padded.data.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect([...padded.data.subarray(256, 259)]).toEqual([4, 5, 6]);
  });

  it('builds the pinned hb-gpu 32-byte vertex ABI', () => {
    const glyph: HbGpuFixtureGlyph = {
      glyphId: 7, sourceBytes: 16, storageOffset: 5, storageTexels: 2, extents: [10, 20, 30, -40]
    };
    const bytes = buildHbGpuVertices(new Map([[7, glyph]]), [
      { glyphId: 7, x: 100, y: 80, fontSize: 20, unitsPerEm: 1000 }
    ]);
    expect(bytes.byteLength).toBe(6 * 32);
    const view = new DataView(bytes.buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(100.2);
    expect(view.getFloat32(4, true)).toBeCloseTo(79.6);
    expect(view.getFloat32(24, true)).toBe(50);
    expect(view.getUint32(28, true)).toBe(5);
  });
});
