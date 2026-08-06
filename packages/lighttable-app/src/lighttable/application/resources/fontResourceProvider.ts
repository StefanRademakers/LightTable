import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import type { SystemFontByteProvider } from '../../text/fonts/DocumentFontRegistry';
import type {
  LightTableResourcePage,
  LightTableResourceProvider,
  LightTableResourceQuery
} from './resourceBrowser';

const fontLabel = (font: DocumentFontAsset): string =>
  font.familyNames[0] ?? font.postScriptName ?? 'Unknown font';

const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

export const createFontResourceProvider = (
  id: string,
  list: () => Promise<readonly DocumentFontAsset[]>,
  bytes: SystemFontByteProvider
): LightTableResourceProvider<Uint8Array> => ({
  id,
  kinds: ['font'],
  async search(query: LightTableResourceQuery, signal): Promise<LightTableResourcePage> {
    signal?.throwIfAborted();
    const fonts = await list();
    signal?.throwIfAborted();
    const needle = query.search?.toLocaleLowerCase() ?? '';
    const filtered = fonts.filter((font) => !needle || [
      ...font.familyNames,
      font.styleName,
      font.postScriptName ?? ''
    ].some((part) => part.toLocaleLowerCase().includes(needle)));
    const start = decodeCursor(query.cursor);
    const size = query.pageSize ?? 50;
    const page = filtered.slice(start, start + size);
    const next = start + page.length;
    return {
      items: page.map((font) => ({
        id: font.assetId,
        kind: 'font',
        name: fontLabel(font),
        providerId: id,
        group: font.source === 'system' ? 'System' : font.source === 'bundled' ? 'Bundled' : 'Document',
        keywords: [font.styleName, font.postScriptName ?? ''].filter(Boolean),
        metadata: {
          style: font.styleName,
          weight: font.weight,
          italic: font.italic,
          byteLength: font.byteLength
        }
      })),
      total: filtered.length,
      ...(next < filtered.length ? { nextCursor: String(next) } : {})
    };
  },
  async load(assetId, signal) {
    signal?.throwIfAborted();
    const font = (await list()).find((candidate) => candidate.assetId === assetId);
    if (!font) return null;
    signal?.throwIfAborted();
    return bytes.load(font);
  }
});
