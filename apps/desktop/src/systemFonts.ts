import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentFontAsset } from '@lighttable/app';

interface CachedFontFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly assets: readonly DocumentFontAsset[];
}

interface FontCatalogCache {
  readonly version: 1;
  readonly files: readonly CachedFontFile[];
}

const u16 = (bytes: Uint8Array, offset: number) => {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error('Invalid SFNT offset.');
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
};
const u32 = (bytes: Uint8Array, offset: number) => (
  u16(bytes, offset) * 0x10000 + u16(bytes, offset + 2)
);
const tagAt = (bytes: Uint8Array, offset: number) => String.fromCharCode(
  bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!
);
const fixed = (value: number) => (value > 0x7fffffff ? value - 0x100000000 : value) / 65536;

interface Table { readonly offset: number; readonly length: number }

const tablesAt = (bytes: Uint8Array, faceOffset: number) => {
  const count = u16(bytes, faceOffset + 4);
  if (count > 512 || faceOffset + 12 + count * 16 > bytes.byteLength) {
    throw new Error('Invalid SFNT table directory.');
  }
  const tables = new Map<string, Table>();
  for (let index = 0; index < count; index += 1) {
    const record = faceOffset + 12 + index * 16;
    const offset = u32(bytes, record + 8);
    const length = u32(bytes, record + 12);
    if (offset + length <= bytes.byteLength) tables.set(tagAt(bytes, record), { offset, length });
  }
  return tables;
};

const decodeName = (bytes: Uint8Array, platform: number) => {
  if (platform === 0 || platform === 3) {
    let result = '';
    for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
      result += String.fromCharCode((bytes[offset]! << 8) | bytes[offset + 1]!);
    }
    return result.replace(/\0/g, '').trim();
  }
  return new TextDecoder('latin1').decode(bytes).replace(/\0/g, '').trim();
};

const readNames = (bytes: Uint8Array, table?: Table) => {
  const names = new Map<number, Array<{ value: string; score: number }>>();
  if (!table || table.length < 6) return names;
  const count = u16(bytes, table.offset + 2);
  const strings = table.offset + u16(bytes, table.offset + 4);
  if (count > 4096 || table.offset + 6 + count * 12 > table.offset + table.length) return names;
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 6 + index * 12;
    const platform = u16(bytes, record);
    const language = u16(bytes, record + 4);
    const nameId = u16(bytes, record + 6);
    const length = u16(bytes, record + 8);
    const offset = strings + u16(bytes, record + 10);
    if (offset + length > table.offset + table.length) continue;
    const value = decodeName(bytes.subarray(offset, offset + length), platform);
    if (!value) continue;
    const score = platform === 3 && language === 0x409 ? 0 : platform === 0 ? 1 : platform === 3 ? 2 : 3;
    const list = names.get(nameId) ?? [];
    list.push({ value, score });
    names.set(nameId, list);
  }
  return names;
};

const bestName = (names: ReturnType<typeof readNames>, ...ids: number[]) => {
  for (const id of ids) {
    const value = [...(names.get(id) ?? [])].sort((a, b) => a.score - b.score)[0]?.value;
    if (value) return value;
  }
  return undefined;
};

const readAxes = (bytes: Uint8Array, table?: Table): DocumentFontAsset['variableAxes'] => {
  if (!table || table.length < 16) return undefined;
  const start = table.offset + u16(bytes, table.offset + 4);
  const count = u16(bytes, table.offset + 8);
  const size = u16(bytes, table.offset + 10);
  if (count > 64 || size < 20 || start + count * size > table.offset + table.length) return undefined;
  return Array.from({ length: count }, (_, index) => {
    const offset = start + index * size;
    return {
      tag: tagAt(bytes, offset),
      minimum: fixed(u32(bytes, offset + 4)),
      defaultValue: fixed(u32(bytes, offset + 8)),
      maximum: fixed(u32(bytes, offset + 12))
    };
  });
};

const embeddingFor = (fsType: number): DocumentFontAsset['embedding'] => ({
  level: (fsType & 0x2) !== 0 ? 'restricted'
    : (fsType & 0x8) !== 0 ? 'editable'
      : (fsType & 0x4) !== 0 ? 'preview-print'
        : 'installable',
  noSubsetting: (fsType & 0x100) !== 0,
  bitmapOnly: (fsType & 0x200) !== 0
});

export const inspectSystemFont = (
  bytes: Uint8Array,
  fingerprintSha256: string
): readonly DocumentFontAsset[] => {
  const faceOffsets = tagAt(bytes, 0) === 'ttcf'
    ? Array.from({ length: Math.min(u32(bytes, 8), 64) }, (_, index) => u32(bytes, 12 + index * 4))
    : [0];
  return faceOffsets.map((faceOffset, faceIndex) => {
    const tables = tablesAt(bytes, faceOffset);
    const names = readNames(bytes, tables.get('name'));
    const os2 = tables.get('OS/2');
    const weight = os2 && os2.length >= 8 ? u16(bytes, os2.offset + 4) : 400;
    const widthClass = os2 && os2.length >= 8 ? u16(bytes, os2.offset + 6) : 5;
    const fsType = os2 && os2.length >= 10 ? u16(bytes, os2.offset + 8) : 0;
    const fsSelection = os2 && os2.length >= 64 ? u16(bytes, os2.offset + 62) : 0;
    const family = bestName(names, 16, 1) ?? 'Unknown system font';
    const styleName = bestName(names, 17, 2) ?? 'Regular';
    const hasTrueType = tables.has('glyf');
    const hasCff2 = tables.has('CFF2');
    const hasCff = tables.has('CFF ');
    const hasSvg = tables.has('SVG ');
    const hasBitmap = tables.has('CBDT') || tables.has('sbix');
    const kinds = [hasTrueType, hasCff, hasCff2, hasSvg, hasBitmap].filter(Boolean).length;
    const outline: DocumentFontAsset['outline'] = kinds > 1 ? 'mixed'
      : hasTrueType ? 'truetype' : hasCff2 ? 'cff2' : hasCff ? 'cff'
        : hasSvg ? 'svg' : hasBitmap ? 'bitmap' : 'unknown';
    return {
      assetId: `system:${fingerprintSha256}:${faceIndex}`,
      faceIndex,
      fingerprintSha256,
      source: 'system',
      container: 'sfnt',
      outline,
      ...(bestName(names, 6) ? { postScriptName: bestName(names, 6)! } : {}),
      embedding: embeddingFor(fsType),
      familyNames: [family],
      styleName,
      weight: Math.max(1, Math.min(1000, weight || 400)),
      stretch: [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200][widthClass - 1] ?? 100,
      italic: (fsSelection & 1) !== 0 || /italic|oblique/i.test(styleName),
      byteLength: bytes.byteLength,
      ...(readAxes(bytes, tables.get('fvar'))?.length
        ? { variableAxes: readAxes(bytes, tables.get('fvar')) }
        : {})
    };
  });
};

const isFontFile = (filePath: string) => /\.(?:ttf|otf|ttc)$/i.test(filePath);

export class WindowsSystemFontCatalog {
  private readonly assetPaths = new Map<string, string>();
  private listing?: Promise<readonly DocumentFontAsset[]>;

  constructor(
    private readonly directories: readonly string[],
    private readonly cachePath: string
  ) {}

  list() {
    this.listing ??= this.scan();
    return this.listing;
  }

  async load(assetId: string) {
    await this.list();
    const filePath = this.assetPaths.get(assetId);
    if (!filePath) return null;
    const bytes = new Uint8Array(await readFile(filePath));
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    return assetId.startsWith(`system:${fingerprint}:`) ? bytes : null;
  }

  private async scan(): Promise<readonly DocumentFontAsset[]> {
    const cached = await this.readCache();
    const cachedByPath = new Map(cached.files.map((entry) => [entry.path.toLowerCase(), entry]));
    const paths: string[] = [];
    for (const directory of this.directories) {
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isFile() && isFontFile(entry.name)) paths.push(path.join(directory, entry.name));
        }
      } catch {
        // An absent per-user font directory is normal.
      }
    }
    const files: CachedFontFile[] = [];
    for (const filePath of [...new Set(paths.map((entry) => path.resolve(entry)))]) {
      try {
        const info = await stat(filePath);
        if (!info.isFile() || info.size < 12 || info.size > 64 * 1024 * 1024) continue;
        const cachedFile = cachedByPath.get(filePath.toLowerCase());
        if (cachedFile && cachedFile.size === info.size && cachedFile.mtimeMs === info.mtimeMs) {
          files.push(cachedFile);
          continue;
        }
        const bytes = new Uint8Array(await readFile(filePath));
        const fingerprint = createHash('sha256').update(bytes).digest('hex');
        files.push({
          path: filePath,
          size: info.size,
          mtimeMs: info.mtimeMs,
          assets: inspectSystemFont(bytes, fingerprint)
        });
      } catch {
        // One damaged or inaccessible font must not hide the rest of the catalog.
      }
    }
    const assets = files.flatMap((entry) => {
      entry.assets.forEach((asset) => this.assetPaths.set(asset.assetId, entry.path));
      return [...entry.assets];
    }).sort((left, right) => (
      left.familyNames[0]!.localeCompare(right.familyNames[0]!, 'en')
      || left.weight - right.weight
      || left.styleName.localeCompare(right.styleName, 'en')
    ));
    void this.writeCache({ version: 1, files });
    return assets;
  }

  private async readCache(): Promise<FontCatalogCache> {
    try {
      const value: unknown = JSON.parse(await readFile(this.cachePath, 'utf8'));
      if (value && typeof value === 'object' && (value as FontCatalogCache).version === 1
        && Array.isArray((value as FontCatalogCache).files)) return value as FontCatalogCache;
    } catch {
      // Cold discovery creates the cache after the app is already interactive.
    }
    return { version: 1, files: [] };
  }

  private async writeCache(cache: FontCatalogCache) {
    try {
      await mkdir(path.dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(cache));
    } catch {
      // Cache persistence is an optimization, never a font availability gate.
    }
  }
}
