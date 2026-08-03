import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSfntFont } from './HarfBuzzFontSubsetter';
import { decodeWebFontToSfnt } from './decodeWebFontToSfnt';

const workspace = fileURLToPath(new URL('../../../../../../', import.meta.url));

describe('lazy web-font PDF decoder', () => {
  it.each(['woff2', 'woff'])('decodes the real bundled Inter %s face into SFNT', async (extension) => {
    const source = new Uint8Array(await readFile(
      `${workspace}node_modules/@fontsource/inter/files/inter-latin-400-normal.${extension}`
    ));
    const decoded = await decodeWebFontToSfnt(source);
    expect(isSfntFont(decoded)).toBe(true);
    expect(decoded.byteLength).toBeGreaterThan(source.byteLength);
  });
});
