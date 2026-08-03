import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createHarfBuzzFontSubsetter,
  isSfntFont,
  subsetSfntFontWithHarfBuzz
} from './HarfBuzzFontSubsetter';

const workspace = fileURLToPath(new URL('../../../../../../', import.meta.url));
const bytes = async (path: string) => new Uint8Array(await readFile(`${workspace}${path}`));

const maxpGlyphCount = (font: Uint8Array) => {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tableCount = view.getUint16(4, false);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    const tableTag = String.fromCharCode(
      font[offset]!, font[offset + 1]!, font[offset + 2]!, font[offset + 3]!
    );
    if (tableTag === 'maxp') return view.getUint16(view.getUint32(offset + 8, false) + 4, false);
  }
  throw new Error('Font has no maxp table.');
};

describe('HarfBuzz font subset adapter', () => {
  it('emits a deterministic, smaller SFNT while retaining source glyph IDs', async () => {
    const [wasm, font] = await Promise.all([
      bytes('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'),
      bytes('test/fixtures/fonts/Anton-Regular.ttf')
    ]);
    const request = { fontBytes: font, faceIndex: 0, glyphIds: [5] };
    const subsetter = await createHarfBuzzFontSubsetter(wasm);
    const first = subsetter.subset(request);
    const second = subsetter.subset(request);

    expect(isSfntFont(first)).toBe(true);
    expect(first.byteLength).toBeLessThan(font.byteLength);
    expect(maxpGlyphCount(first)).toBeGreaterThanOrEqual(6);
    expect(first).toEqual(second);
  });

  it('rejects malformed and over-budget requests before subsetting', async () => {
    const wasm = await bytes('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');
    await expect(subsetSfntFontWithHarfBuzz(wasm, {
      fontBytes: new Uint8Array([1, 2, 3, 4]), faceIndex: 0, glyphIds: [1]
    })).rejects.toThrow('must be an SFNT');
    const font = await bytes('test/fixtures/fonts/Anton-Regular.ttf');
    await expect(subsetSfntFontWithHarfBuzz(wasm, {
      fontBytes: font, faceIndex: 0, glyphIds: [65_536]
    })).rejects.toThrow('unsigned 16-bit');
    await expect(subsetSfntFontWithHarfBuzz(wasm, {
      fontBytes: font, faceIndex: 0, glyphIds: [1], variableAxes: { weight: 400 }
    })).rejects.toThrow('four ASCII');
  });
});
