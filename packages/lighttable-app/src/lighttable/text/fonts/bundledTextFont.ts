import interRegularUrl from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import type { DocumentFontRegistry } from './DocumentFontRegistry';

export const BUNDLED_TEXT_FONT_FAMILY = 'Inter';
export const BUNDLED_TEXT_FONT_STYLE = 'Regular';
export const BUNDLED_TEXT_FONT_ASSET_ID = 'lighttable-inter-latin-regular';

let bundledBytesPromise: Promise<Uint8Array> | null = null;

const loadBundledBytes = async () => {
  if (!bundledBytesPromise) {
    const attempt = fetch(interRegularUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Bundled Inter could not be loaded (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    });
    bundledBytesPromise = attempt;
    void attempt.catch(() => {
      if (bundledBytesPromise === attempt) bundledBytesPromise = null;
    });
  }
  return Uint8Array.from(await bundledBytesPromise);
};

/** Registers the OFL-licensed product font without parsing or starting WASM. */
export const registerBundledTextFont = async (
  registry: DocumentFontRegistry
): Promise<DocumentFontAsset> => {
  const available = registry.availableAssets.find(
    ({ assetId }) => assetId === BUNDLED_TEXT_FONT_ASSET_ID
  );
  if (available) return available;
  return registry.registerBytes(await loadBundledBytes(), {
    assetId: BUNDLED_TEXT_FONT_ASSET_ID,
    faceIndex: 0,
    source: 'bundled',
    container: 'woff2',
    outline: 'truetype',
    postScriptName: 'Inter-Regular',
    embedding: {
      level: 'installable',
      noSubsetting: false,
      bitmapOnly: false
    },
    familyNames: [BUNDLED_TEXT_FONT_FAMILY],
    styleName: BUNDLED_TEXT_FONT_STYLE,
    weight: 400,
    stretch: 100,
    italic: false
  });
};
