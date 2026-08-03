import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyValidatedHbGpuStorage, parseHbGpuFixtureBundle } from './hbGpuBundle';

const fixture = () => new Uint8Array(readFileSync(resolve(
  '../../test/fixtures/text-renderer/hb-gpu/anton.lt-hbgpu'
)));

describe('hb-gpu fixed corpus validation', () => {
  it('validates ranges and widens upstream RGBA16I texels for WebGPU storage', () => {
    const parsed = parseHbGpuFixtureBundle(fixture());
    expect(parsed.glyphs).toHaveLength(12);
    expect(parsed.gpuBytes).toBe((parsed.sourceBytes - 12 - parsed.glyphs.length * 24) * 2);
    expect(parsed.glyphs.some((glyph) => glyph.storageTexels > 0)).toBe(true);
  });

  it('rejects truncated and shader-loop-amplifying blobs before upload', () => {
    const bytes = fixture();
    expect(() => parseHbGpuFixtureBundle(bytes.subarray(0, bytes.length - 1))).toThrow(/Truncated|complete/);
    const mutated = Uint8Array.from(bytes);
    const firstBlob = 12 + 24;
    new DataView(mutated.buffer).setInt16(firstBlob + 2 * 8, 32_767, true);
    expect(() => parseHbGpuFixtureBundle(mutated)).toThrow(/curve count/);
  });

  it('revalidates mutable widened storage immediately before upload', () => {
    const parsed = parseHbGpuFixtureBundle(fixture());
    const storage = new Int32Array(parsed.storage);
    storage[4] = 30_000;
    expect(() => copyValidatedHbGpuStorage({ ...parsed, storage })).toThrow(/band|range|limit/);
  });
});
