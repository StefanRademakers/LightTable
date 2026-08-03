import { TextRendererResourceLimitError } from './contracts';

export const COVERAGE_ATLAS_RASTERIZER_VERSION = 1 as const;
export const COVERAGE_PPEM_BUCKETS = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
  56, 57, 58, 59, 60, 61, 62, 63, 64, 72, 80, 96, 112, 128, 160,
  192, 224, 256
] as const;

export interface CoverageAtlasGlyphKey {
  readonly fontFingerprintSha256: string;
  readonly faceIndex: number;
  readonly glyphId: number;
  readonly variationCoordinates: Readonly<Record<string, number>>;
  readonly syntheticBold: boolean;
  readonly syntheticItalic: boolean;
  readonly hinting: 'smooth';
  readonly ppem: number;
  readonly renderMode: 'alpha';
  readonly rasterizerVersion: typeof COVERAGE_ATLAS_RASTERIZER_VERSION;
}

export interface CoverageAtlasPlacement {
  readonly serializedKey: string;
  readonly pageId: number;
  readonly pageGeneration: number;
  readonly atlasGeneration: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bearingX: number;
  readonly bearingY: number;
  readonly empty: boolean;
}

export interface CoverageAtlasCacheMetrics {
  readonly pages: number;
  readonly entries: number;
  readonly allocatedBytes: number;
  readonly occupiedBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly uploads: number;
  readonly uploadedBytes: number;
  readonly atlasGeneration: number;
}

interface Page {
  readonly id: number;
  generation: number;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  touched: number;
  occupiedBytes: number;
  keys: Set<string>;
}

const finiteInteger = (value: number, minimum: number, maximum: number, label: string) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer in [${minimum}, ${maximum}].`);
  }
};

const serializeF32 = (value: number) => {
  const normalized = Object.is(value, -0) ? 0 : value;
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, normalized, false);
  return new DataView(bytes).getUint32(0, false).toString(16).padStart(8, '0');
};

export const quantizeCoveragePpem = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('Coverage ppem must be finite and positive.');
  return COVERAGE_PPEM_BUCKETS.reduce((best, bucket) => (
    Math.abs(bucket - value) < Math.abs(best - value) ? bucket : best
  ));
};

export const serializeCoverageAtlasGlyphKey = (key: CoverageAtlasGlyphKey) => {
  if (!/^[a-f0-9]{64}$/i.test(key.fontFingerprintSha256)) throw new TypeError('Coverage font fingerprint must be SHA-256.');
  finiteInteger(key.faceIndex, 0, 0xffff_ffff, 'Coverage face index');
  finiteInteger(key.glyphId, 0, 0xffff_ffff, 'Coverage glyph id');
  if (key.rasterizerVersion !== COVERAGE_ATLAS_RASTERIZER_VERSION) {
    throw new TypeError('Coverage rasterizer version is unsupported.');
  }
  if (typeof key.syntheticBold !== 'boolean' || typeof key.syntheticItalic !== 'boolean') {
    throw new TypeError('Coverage synthesis flags must be boolean.');
  }
  if (key.hinting !== 'smooth' || key.renderMode !== 'alpha') {
    throw new TypeError('Coverage raster profile is unsupported.');
  }
  if (!COVERAGE_PPEM_BUCKETS.includes(key.ppem as typeof COVERAGE_PPEM_BUCKETS[number])) {
    throw new TypeError('Coverage ppem must be a canonical scale bucket.');
  }
  const variations = Object.entries(key.variationCoordinates)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [tag, value] of variations) {
    if (!/^[\x20-\x7e]{4}$/.test(tag) || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new TypeError('Coverage variation coordinates are invalid.');
    }
  }
  return [
    `r${key.rasterizerVersion}`, key.fontFingerprintSha256.toLowerCase(), key.faceIndex,
    key.glyphId, key.syntheticBold ? 'b1' : 'b0', key.syntheticItalic ? 'i1' : 'i0',
    key.hinting, key.ppem, key.renderMode,
    variations.map(([tag, value]) => `${tag}:${serializeF32(value)}`).join(',')
  ].join('|');
};

export class CoverageAtlasCache {
  private readonly pages = new Map<number, Page>();
  private readonly entries = new Map<string, CoverageAtlasPlacement>();
  private readonly emptyKeys = new Map<string, number>();
  private clock = 0;
  private nextPageId = 1;
  private atlasGeneration = 1;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private uploads = 0;
  private uploadedBytes = 0;

  constructor(
    readonly pageDimension = 1024,
    readonly maximumPages = 8,
    readonly padding = 1,
    readonly maximumEmptyEntries = 4096
  ) {
    finiteInteger(pageDimension, 64, 4096, 'Coverage atlas page dimension');
    finiteInteger(maximumPages, 1, 64, 'Coverage atlas maximum pages');
    finiteInteger(padding, 0, 8, 'Coverage atlas padding');
    finiteInteger(maximumEmptyEntries, 1, 65_536, 'Coverage atlas maximum empty entries');
  }

  lookup(key: CoverageAtlasGlyphKey, recordMiss = true) {
    const serialized = serializeCoverageAtlasGlyphKey(key);
    const placement = this.entries.get(serialized);
    if (!placement || placement.atlasGeneration !== this.atlasGeneration) {
      if (recordMiss) this.misses += 1;
      return null;
    }
    this.hits += 1;
    if (placement.empty) this.touchEmpty(serialized);
    const page = this.pages.get(placement.pageId);
    if (page) page.touched = ++this.clock;
    return placement;
  }

  reserve(key: CoverageAtlasGlyphKey, width: number, height: number, bearingX = 0, bearingY = 0) {
    finiteInteger(width, 0, 256, 'Coverage glyph width');
    finiteInteger(height, 0, 256, 'Coverage glyph height');
    if (!Number.isFinite(bearingX) || !Number.isFinite(bearingY)) {
      throw new TypeError('Coverage glyph bearings must be finite.');
    }
    const serialized = serializeCoverageAtlasGlyphKey(key);
    const existing = this.entries.get(serialized);
    if (existing && existing.atlasGeneration === this.atlasGeneration) {
      this.hits += 1;
      if (existing.empty) this.touchEmpty(serialized);
      const page = this.pages.get(existing.pageId);
      if (page) page.touched = ++this.clock;
      return { placement: existing, created: false, evictedPageId: null as number | null };
    }
    this.misses += 1;
    if (width === 0 || height === 0) {
      if (this.emptyKeys.size >= this.maximumEmptyEntries) {
        const oldest = this.emptyKeys.keys().next().value as string;
        this.emptyKeys.delete(oldest);
        this.entries.delete(oldest);
        this.evictions += 1;
      }
      const placement: CoverageAtlasPlacement = {
        serializedKey: serialized, pageId: 0, pageGeneration: 0,
        atlasGeneration: this.atlasGeneration, x: 0, y: 0, width: 0, height: 0,
        bearingX, bearingY, empty: true
      };
      this.entries.set(serialized, placement);
      this.emptyKeys.set(serialized, ++this.clock);
      return { placement, created: true, evictedPageId: null as number | null };
    }
    if (width + this.padding * 2 > this.pageDimension || height + this.padding * 2 > this.pageDimension) {
      throw new TextRendererResourceLimitError('Coverage glyph does not fit an atlas page.');
    }
    let page = [...this.pages.values()].find((candidate) => this.fits(candidate, width, height));
    let evictedPageId: number | null = null;
    if (!page && this.pages.size < this.maximumPages) page = this.createPage();
    if (!page) {
      page = [...this.pages.values()].sort((left, right) => left.touched - right.touched)[0];
      evictedPageId = page.id;
      this.resetPage(page);
      this.evictions += 1;
    }
    const position = this.place(page, width, height);
    const placement: CoverageAtlasPlacement = {
      serializedKey: serialized, pageId: page.id, pageGeneration: page.generation,
      atlasGeneration: this.atlasGeneration, ...position, width, height,
      bearingX, bearingY, empty: false
    };
    page.keys.add(serialized);
    page.occupiedBytes += width * height;
    page.touched = ++this.clock;
    this.entries.set(serialized, placement);
    return { placement, created: true, evictedPageId };
  }

  recordUpload(placement: CoverageAtlasPlacement, byteLength: number) {
    if (!this.isCurrent(placement)) throw new Error('Coverage upload targets a stale atlas placement.');
    finiteInteger(byteLength, 0, 65_536, 'Coverage upload byte length');
    this.uploads += 1;
    this.uploadedBytes += byteLength;
  }

  /** Drops a failed, not-yet-published reservation without reusing its shelf gap. */
  discardReservation(placement: CoverageAtlasPlacement) {
    if (!this.isCurrent(placement)) return false;
    this.entries.delete(placement.serializedKey);
    this.emptyKeys.delete(placement.serializedKey);
    if (!placement.empty) {
      const page = this.pages.get(placement.pageId);
      page?.keys.delete(placement.serializedKey);
      if (page) page.occupiedBytes -= placement.width * placement.height;
    }
    return true;
  }

  isCurrent(placement: CoverageAtlasPlacement) {
    if (placement.empty) {
      return placement.atlasGeneration === this.atlasGeneration
        && this.entries.get(placement.serializedKey) === placement;
    }
    const page = this.pages.get(placement.pageId);
    return placement.atlasGeneration === this.atlasGeneration
      && page?.generation === placement.pageGeneration
      && this.entries.get(placement.serializedKey) === placement;
  }

  resetForDeviceLoss() {
    this.pages.clear();
    this.entries.clear();
    this.emptyKeys.clear();
    this.atlasGeneration += 1;
    this.nextPageId = 1;
  }

  metrics(): CoverageAtlasCacheMetrics {
    return {
      pages: this.pages.size, entries: this.entries.size,
      allocatedBytes: this.pages.size * this.pageDimension * this.pageDimension,
      occupiedBytes: [...this.pages.values()].reduce((sum, page) => sum + page.occupiedBytes, 0),
      hits: this.hits, misses: this.misses, evictions: this.evictions,
      uploads: this.uploads, uploadedBytes: this.uploadedBytes, atlasGeneration: this.atlasGeneration
    };
  }

  private createPage() {
    const page: Page = { id: this.nextPageId++, generation: 1, cursorX: this.padding,
      cursorY: this.padding, rowHeight: 0, touched: ++this.clock, occupiedBytes: 0, keys: new Set() };
    this.pages.set(page.id, page);
    return page;
  }

  private touchEmpty(key: string) {
    this.emptyKeys.delete(key);
    this.emptyKeys.set(key, ++this.clock);
  }

  private resetPage(page: Page) {
    for (const key of page.keys) this.entries.delete(key);
    page.keys.clear();
    page.generation += 1;
    page.cursorX = this.padding;
    page.cursorY = this.padding;
    page.rowHeight = 0;
    page.occupiedBytes = 0;
    page.touched = ++this.clock;
  }

  private fits(page: Page, width: number, height: number) {
    const paddedWidth = width + this.padding * 2;
    const paddedHeight = height + this.padding * 2;
    return page.cursorX + width + this.padding <= this.pageDimension
      ? page.cursorY + Math.max(page.rowHeight, paddedHeight) <= this.pageDimension
      : this.padding + width + this.padding <= this.pageDimension
        && page.cursorY + page.rowHeight + paddedHeight <= this.pageDimension;
  }

  private place(page: Page, width: number, height: number) {
    const paddedWidth = width + this.padding * 2;
    const paddedHeight = height + this.padding * 2;
    if (page.cursorX + width + this.padding > this.pageDimension) {
      page.cursorX = this.padding;
      page.cursorY += page.rowHeight;
      page.rowHeight = 0;
    }
    const result = { x: page.cursorX, y: page.cursorY };
    page.cursorX += paddedWidth;
    page.rowHeight = Math.max(page.rowHeight, paddedHeight);
    return result;
  }
}
