import { describe, expect, it } from 'vitest';
import { packCoverageAtlas } from './coverageAtlas';
import { TextRendererResourceLimitError } from './contracts';

const mask = (key: string, width: number, height: number, value: number) => ({
  key, width, height, bearingX: 0, bearingY: height,
  pixels: new Uint8Array(width * height).fill(value)
});

describe('coverage atlas bakeoff packer', () => {
  it('packs deterministic R8 masks with padding and preserved pixels', () => {
    const atlas = packCoverageAtlas([mask('a', 3, 2, 40), mask('b', 2, 3, 200)], 8, 1);
    expect(atlas).toMatchObject({ width: 8, height: 16, occupiedBytes: 12 });
    expect(atlas.entries.map((entry) => [entry.key, entry.x, entry.y])).toEqual([
      ['a', 1, 1], ['b', 1, 5]
    ]);
    expect(atlas.pixels[1 * 8 + 1]).toBe(40);
    expect(atlas.pixels[5 * 8 + 1]).toBe(200);
  });

  it('rejects malformed, duplicate and pathological masks before allocation', () => {
    expect(() => packCoverageAtlas([{ ...mask('a', 2, 2, 1), pixels: new Uint8Array(3) }], 8))
      .toThrow(/one R8 byte/);
    expect(() => packCoverageAtlas([mask('a', 1, 1, 1), mask('a', 1, 1, 2)], 8)).toThrow(/Duplicate/);
    expect(() => packCoverageAtlas([mask('wide', 257, 1, 1)], 512)).toThrow(TextRendererResourceLimitError);
  });

  it('keeps empty glyphs addressable without allocating outside the atlas', () => {
    const atlas = packCoverageAtlas([mask('space', 0, 0, 0)], 8);
    expect(atlas).toMatchObject({ width: 8, height: 1, occupiedBytes: 0 });
    expect(atlas.entries[0]).toMatchObject({ key: 'space', x: 0, y: 0, width: 0, height: 0 });
  });
});
