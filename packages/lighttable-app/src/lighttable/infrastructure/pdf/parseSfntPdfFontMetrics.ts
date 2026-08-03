const MAXIMUM_SFNT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_TABLE_COUNT = 256;
const MAXIMUM_GLYPH_COUNT = 65_535;

export interface PdfSfntFontMetrics {
  readonly outline: 'truetype' | 'cff';
  readonly unitsPerEm: number;
  readonly glyphCount: number;
  readonly boundingBox: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly italicAngle: number;
  readonly flags: number;
  readonly stemV: number;
  readonly missingWidth: number;
  readonly widths: ReadonlyMap<number, number>;
}

interface SfntTable {
  readonly offset: number;
  readonly length: number;
}

const fail = (message: string): never => {
  throw new Error(`PDF SFNT metrics ${message}`);
};

const normalizedMetric = (value: number, unitsPerEm: number) => Math.round(value * 1_000 / unitsPerEm);

const fixed16_16 = (view: DataView, offset: number) => (
  view.getInt16(offset, false) + view.getUint16(offset + 2, false) / 65_536
);

const tableDirectory = (bytes: Uint8Array, view: DataView) => {
  const signature = view.getUint32(0, false);
  if (![0x0001_0000, 0x4f54544f, 0x74727565, 0x74797031].includes(signature)) {
    fail('requires a TrueType/OpenType SFNT container.');
  }
  const count = view.getUint16(4, false);
  if (count < 1 || count > MAXIMUM_TABLE_COUNT || 12 + count * 16 > bytes.byteLength) {
    fail('contains an invalid table directory.');
  }
  const tables = new Map<string, SfntTable>();
  for (let index = 0; index < count; index += 1) {
    const entry = 12 + index * 16;
    const tag = String.fromCharCode(
      view.getUint8(entry), view.getUint8(entry + 1),
      view.getUint8(entry + 2), view.getUint8(entry + 3)
    );
    const offset = view.getUint32(entry + 8, false);
    const length = view.getUint32(entry + 12, false);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
      fail(`table ${tag} exceeds the font bytes.`);
    }
    if (!tables.has(tag)) tables.set(tag, { offset, length });
  }
  return { signature, tables };
};

const requiredTable = (
  tables: ReadonlyMap<string, SfntTable>,
  tag: string,
  minimumLength: number
) => {
  const table = tables.get(tag) ?? fail(`is missing required ${tag} table.`);
  if (table.length < minimumLength) fail(`table ${tag} is truncated.`);
  return table;
};

/** Reads only bounded, writer-required metrics; it never mutates font bytes. */
export const parseSfntPdfFontMetrics = (
  source: Uint8Array,
  glyphIds: readonly number[]
): PdfSfntFontMetrics => {
  if (source.byteLength < 12 || source.byteLength > MAXIMUM_SFNT_BYTES) {
    fail(`input must contain at most ${MAXIMUM_SFNT_BYTES} bytes.`);
  }
  const bytes = Uint8Array.from(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { signature, tables } = tableDirectory(bytes, view);
  const head = requiredTable(tables, 'head', 54);
  const hhea = requiredTable(tables, 'hhea', 36);
  const maxp = requiredTable(tables, 'maxp', 6);
  const hmtx = requiredTable(tables, 'hmtx', 4);
  const unitsPerEm = view.getUint16(head.offset + 18, false);
  if (unitsPerEm < 16 || unitsPerEm > 16_384) fail('has invalid unitsPerEm.');
  const glyphCount = view.getUint16(maxp.offset + 4, false);
  if (glyphCount < 1 || glyphCount > MAXIMUM_GLYPH_COUNT) fail('has invalid glyph count.');
  const horizontalMetricCount = view.getUint16(hhea.offset + 34, false);
  if (horizontalMetricCount < 1 || horizontalMetricCount > glyphCount) {
    fail('has invalid horizontal metric count.');
  }
  const requiredHmtxLength = horizontalMetricCount * 4
    + (glyphCount - horizontalMetricCount) * 2;
  if (hmtx.length < requiredHmtxLength) fail('table hmtx is truncated.');

  const uniqueGlyphIds = [...new Set([0, ...glyphIds])].sort((left, right) => left - right);
  uniqueGlyphIds.forEach(glyphId => {
    if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= glyphCount) {
      fail(`glyph ${glyphId} is outside the font glyph range.`);
    }
  });
  const advanceWidth = (glyphId: number) => {
    const metricIndex = Math.min(glyphId, horizontalMetricCount - 1);
    return view.getUint16(hmtx.offset + metricIndex * 4, false);
  };
  const widths = new Map(uniqueGlyphIds.map(glyphId => [
    glyphId,
    normalizedMetric(advanceWidth(glyphId), unitsPerEm)
  ]));

  const os2 = tables.get('OS/2');
  const post = tables.get('post');
  const weightClass = os2 && os2.length >= 8
    ? Math.max(1, Math.min(1_000, view.getUint16(os2.offset + 4, false)))
    : 400;
  const os2Version = os2 && os2.length >= 2 ? view.getUint16(os2.offset, false) : 0;
  const ascent = view.getInt16(hhea.offset + 4, false);
  const descent = view.getInt16(hhea.offset + 6, false);
  const capHeight = os2 && os2Version >= 2 && os2.length >= 90
    ? view.getInt16(os2.offset + 88, false)
    : ascent;
  const italicAngle = post && post.length >= 16 ? fixed16_16(view, post.offset + 4) : 0;
  const fixedPitch = post && post.length >= 16 && view.getUint32(post.offset + 12, false) !== 0;
  // PDF FontDescriptor flags: fixed-pitch=1, nonsymbolic=32, italic=64.
  const flags = (fixedPitch ? 1 : 0) | 32 | (Math.abs(italicAngle) > 1e-6 ? 64 : 0);
  return Object.freeze({
    outline: signature === 0x4f54544f || tables.has('CFF ') || tables.has('CFF2')
      ? 'cff' : 'truetype',
    unitsPerEm,
    glyphCount,
    boundingBox: Object.freeze([
      normalizedMetric(view.getInt16(head.offset + 36, false), unitsPerEm),
      normalizedMetric(view.getInt16(head.offset + 38, false), unitsPerEm),
      normalizedMetric(view.getInt16(head.offset + 40, false), unitsPerEm),
      normalizedMetric(view.getInt16(head.offset + 42, false), unitsPerEm)
    ] as const),
    ascent: normalizedMetric(ascent, unitsPerEm),
    descent: normalizedMetric(descent, unitsPerEm),
    capHeight: normalizedMetric(capHeight, unitsPerEm),
    italicAngle,
    flags,
    stemV: Math.round(50 + weightClass / 10),
    missingWidth: widths.get(0)!,
    widths
  });
};
