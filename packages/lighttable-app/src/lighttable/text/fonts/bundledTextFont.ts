import interRegularUrl from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interSemiBoldUrl from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import sourceSerifRegularUrl from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url';
import sourceSerifItalicUrl from '@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2?url';
import sourceSerifBoldUrl from '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2?url';
import jetBrainsMonoRegularUrl from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import jetBrainsMonoBoldUrl from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url';
import notoSansRegularUrl from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2?url';
import notoSansBoldUrl from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff2?url';
import type { TextToolSettings } from '../../editor/session/editorSession';
import type { DocumentFontAsset, ImageDocument, LayerNode } from '../../editor/document/documentTypes';
import type { DocumentFontRegistry } from './DocumentFontRegistry';

export const BUNDLED_TEXT_FONT_FAMILY = 'Inter';
export const BUNDLED_TEXT_FONT_STYLE = 'Regular';
export const BUNDLED_TEXT_FONT_ASSET_ID = 'lighttable-inter-latin-regular';

interface BundledFontDefinition {
  readonly url: string;
  readonly asset: DocumentFontAsset;
}

const definition = (
  url: string,
  assetId: string,
  family: string,
  styleName: string,
  postScriptName: string,
  weight: number,
  byteLength: number,
  fingerprintSha256: string,
  italic = false
): BundledFontDefinition => ({
  url,
  asset: {
    assetId,
    faceIndex: 0,
    fingerprintSha256,
    byteLength,
    source: 'bundled',
    container: 'woff2',
    outline: 'truetype',
    postScriptName,
    embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
    familyNames: [family],
    styleName,
    weight,
    stretch: 100,
    italic
  }
});

const definitions: readonly BundledFontDefinition[] = [
  definition(interRegularUrl, BUNDLED_TEXT_FONT_ASSET_ID, 'Inter', 'Regular', 'Inter-Regular', 400, 23_664, '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc'),
  definition(interSemiBoldUrl, 'lighttable-inter-latin-semibold', 'Inter', 'SemiBold', 'Inter-SemiBold', 600, 24_452, 'f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a'),
  definition(sourceSerifRegularUrl, 'lighttable-source-serif-4-latin-regular', 'Source Serif 4', 'Regular', 'SourceSerif4-Regular', 400, 20_088, '02194deb92d3975dd30e11a3824a1f1db32b48c93654e60560cb81ce8e7b5f95'),
  definition(sourceSerifItalicUrl, 'lighttable-source-serif-4-latin-italic', 'Source Serif 4', 'Italic', 'SourceSerif4-It', 400, 20_092, '882b7c150c29f29d4f8daae6b8dcae8662aac7f28ca34b34615305154136ecfd', true),
  definition(sourceSerifBoldUrl, 'lighttable-source-serif-4-latin-bold', 'Source Serif 4', 'Bold', 'SourceSerif4-Bold', 700, 21_716, '7691c51bc286a9014db0048277d2c3f2ad0a90b533dc8adfb16cb22a95390d39'),
  definition(jetBrainsMonoRegularUrl, 'lighttable-jetbrains-mono-latin-regular', 'JetBrains Mono', 'Regular', 'JetBrainsMono-Regular', 400, 21_168, '14425ba9c695763c1547f48a206b7aa60350a33ae23de09f0407877f3fcd89eb'),
  definition(jetBrainsMonoBoldUrl, 'lighttable-jetbrains-mono-latin-bold', 'JetBrains Mono', 'Bold', 'JetBrainsMono-Bold', 700, 21_908, 'd0d4e818808f2a0ba39b2b09d1989366f63494e295f003c7ef436697378507e8'),
  definition(notoSansRegularUrl, 'lighttable-noto-sans-latin-regular', 'Noto Sans', 'Regular', 'NotoSans-Regular', 400, 13_104, '0d352d8a993d3f79d860e44d74ee3e132649253f2af24caad088c3aed6ec08c8'),
  definition(notoSansBoldUrl, 'lighttable-noto-sans-latin-bold', 'Noto Sans', 'Bold', 'NotoSans-Bold', 700, 13_416, 'e65482fd7d8cd5e24b81e2fd2cac0ad642bfea4e59c3b1052b7a3b4ffedf4465')
];

/** Metadata-only catalog used by selectors; importing it fetches no font bytes. */
export const BUNDLED_TEXT_FONT_CATALOG: readonly DocumentFontAsset[] = Object.freeze(
  definitions.map(({ asset }) => Object.freeze(structuredClone(asset)))
);

const bytePromises = new Map<string, Promise<Uint8Array>>();

const registerDefinition = async (
  registry: DocumentFontRegistry,
  font: BundledFontDefinition
): Promise<DocumentFontAsset> => {
  const available = registry.availableAssets.find(({ assetId }) => assetId === font.asset.assetId);
  if (available) return available;
  let pending = bytePromises.get(font.asset.assetId);
  if (!pending) {
    const attempt = fetch(font.url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${font.asset.familyNames[0]} ${font.asset.styleName} could not be loaded (${response.status}).`);
      }
      return new Uint8Array(await response.arrayBuffer());
    });
    pending = attempt;
    bytePromises.set(font.asset.assetId, attempt);
    void attempt.catch(() => {
      if (bytePromises.get(font.asset.assetId) === attempt) bytePromises.delete(font.asset.assetId);
    });
  }
  return registry.registerBytes(Uint8Array.from(await pending), font.asset);
};

export const registerBundledTextFontByAssetId = (
  registry: DocumentFontRegistry,
  assetId: string
) => {
  const font = definitions.find(({ asset }) => asset.assetId === assetId);
  return font ? registerDefinition(registry, font) : Promise.resolve(null);
};

export const registerBundledTextFontForSettings = (
  registry: DocumentFontRegistry,
  settings: Pick<TextToolSettings, 'family' | 'style'>
) => {
  const font = definitions.find(({ asset }) =>
    asset.familyNames.includes(settings.family) && asset.styleName === settings.style
  );
  return font ? registerDefinition(registry, font) : Promise.resolve(null);
};

/** Loads only the default face when it is actually requested for authoring. */
export const registerBundledTextFont = (
  registry: DocumentFontRegistry
): Promise<DocumentFontAsset> => registerDefinition(registry, definitions[0]!);

const requestedPostScriptNames = (nodes: readonly LayerNode[], result: Set<string>) => {
  nodes.forEach((node) => {
    if (node.type === 'group') requestedPostScriptNames(node.children, result);
    else if (node.type === 'text' && node.text.source.kind === 'flow') {
      node.text.source.styleRuns.forEach(({ requestedFont }) => {
        if (requestedFont.postScriptName) result.add(requestedFont.postScriptName);
      });
    }
  });
};

/** Lazily loads only bundled faces explicitly requested by an opened document, plus one fallback. */
export const registerBundledTextFontsForDocument = async (
  registry: DocumentFontRegistry,
  document: ImageDocument
) => {
  const requested = new Set<string>();
  requestedPostScriptNames(document.layers, requested);
  const exact = definitions.filter(({ asset }) => asset.postScriptName
    && requested.has(asset.postScriptName));
  const selected = exact.some(({ asset }) => asset.assetId === BUNDLED_TEXT_FONT_ASSET_ID)
    ? exact : [definitions[0]!, ...exact];
  return Promise.all(selected.map((font) => registerDefinition(registry, font)));
};
