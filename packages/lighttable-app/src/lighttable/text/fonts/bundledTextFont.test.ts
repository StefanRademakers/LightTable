import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentFontRegistry } from './DocumentFontRegistry';
import {
  BUNDLED_TEXT_FONT_ASSET_ID,
  registerBundledTextFont
} from './bundledTextFont';

afterEach(() => vi.unstubAllGlobals());

describe('registerBundledTextFont', () => {
  it('registers deterministic product metadata without eagerly parsing WASM', async () => {
    const parse = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
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
});
