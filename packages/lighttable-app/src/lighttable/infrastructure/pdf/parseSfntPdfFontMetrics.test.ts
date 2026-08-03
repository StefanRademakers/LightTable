import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHarfBuzzFontSubsetter } from './HarfBuzzFontSubsetter';
import { parseSfntPdfFontMetrics } from './parseSfntPdfFontMetrics';

const workspace = fileURLToPath(new URL('../../../../../../', import.meta.url));
const antonFixture = `${workspace}test/fixtures/fonts/Anton-Regular.ttf`;

describe('parseSfntPdfFontMetrics', () => {
  it('reads bounded PDF descriptor metrics and retained-glyph widths from a real SFNT', async () => {
    const bytes = new Uint8Array(await readFile(antonFixture));
    const metrics = parseSfntPdfFontMetrics(bytes, [1, 2, 36]);

    expect(metrics.outline).toBe('truetype');
    expect(metrics.unitsPerEm).toBeGreaterThanOrEqual(16);
    expect(metrics.glyphCount).toBeGreaterThan(36);
    expect(metrics.boundingBox[2]).toBeGreaterThan(metrics.boundingBox[0]);
    expect(metrics.boundingBox[3]).toBeGreaterThan(metrics.boundingBox[1]);
    expect(metrics.ascent).toBeGreaterThan(0);
    expect(metrics.descent).toBeLessThanOrEqual(0);
    expect(metrics.widths.get(0)).toBeTypeOf('number');
    expect(metrics.widths.get(36)).toBeGreaterThan(0);
    expect(Object.isFrozen(metrics)).toBe(true);
  });

  it('rejects malformed directories and out-of-range glyphs', async () => {
    expect(() => parseSfntPdfFontMetrics(Uint8Array.of(0, 1, 0, 0), [0]))
      .toThrow('input must contain');
    const bytes = new Uint8Array(await readFile(antonFixture));
    expect(() => parseSfntPdfFontMetrics(bytes, [65_535]))
      .toThrow('outside the font glyph range');
  });

  it('reads the retain-GID SFNT emitted by the production subsetter', async () => {
    const [font, wasm] = await Promise.all([
      readFile(antonFixture),
      readFile(`${workspace}node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm`)
    ]);
    const subsetter = await createHarfBuzzFontSubsetter(new Uint8Array(wasm));
    const subset = subsetter.subset({
      fontBytes: new Uint8Array(font),
      faceIndex: 0,
      glyphIds: [0, 36],
      variableAxes: {},
      downgradeCff2: false
    });
    const metrics = parseSfntPdfFontMetrics(subset, [0, 36]);
    expect(metrics.widths.get(36)).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(font.byteLength);
  });
});
