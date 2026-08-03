import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DocumentFontRegistry } from './DocumentFontRegistry';
import {
  BUNDLED_TEXT_FONT_CATALOG,
  BUNDLED_TEXT_FONT_ASSET_ID,
  registerBundledTextFont,
  registerBundledTextFontForSettings
} from './bundledTextFont';

afterEach(() => vi.unstubAllGlobals());

describe('registerBundledTextFont', () => {
  it('exposes multiple selector faces without fetching or allocating their bytes', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    expect([...new Set(BUNDLED_TEXT_FONT_CATALOG.flatMap(({ familyNames }) => familyNames))])
      .toEqual(['Inter', 'Source Serif 4', 'JetBrains Mono', 'Noto Sans']);
    expect(BUNDLED_TEXT_FONT_CATALOG).toHaveLength(9);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers deterministic product metadata without eagerly parsing WASM', async () => {
    const parse = vi.fn();
    const bytes = await readFile(resolve(
      '../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'
    ));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const registry = new DocumentFontRegistry({ parser: { parse } });
    const first = await registerBundledTextFont(registry);
    const second = await registerBundledTextFont(registry);
    expect(first).toMatchObject({
      assetId: BUNDLED_TEXT_FONT_ASSET_ID,
      source: 'bundled',
      familyNames: ['Inter'],
      styleName: 'Regular',
      weight: 400,
      italic: false
    });
    expect(second).toEqual(first);
    expect(registry.availableAssets).toEqual([first]);
    expect(parse).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('loads only the face selected for authoring', async () => {
    const bytes = await readFile(resolve(
      '../../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2'
    ));
    const fetch = vi.fn(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetch);
    const registry = new DocumentFontRegistry({ parser: { parse: vi.fn() } });

    await expect(registerBundledTextFontForSettings(registry, {
      family: 'Source Serif 4', style: 'Regular'
    })).resolves.toMatchObject({
      familyNames: ['Source Serif 4'], styleName: 'Regular', byteLength: 20_088
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(registry.availableAssets).toHaveLength(1);
    registry.dispose();
  });
});
