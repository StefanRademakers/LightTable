import { TEXT_RENDERER_BAKEOFF_LIMITS, TextRendererResourceLimitError } from './contracts';

const MAGIC = [0x4c, 0x54, 0x48, 0x42, 0x47, 0x50, 0x55, 1] as const;
const RECORD_HEADER_BYTES = 24;
const TEXEL_BYTES = 8;
const MAX_BANDS = 16;
const MAX_CURVES_PER_BAND = 4096;

export interface HbGpuFixtureGlyph {
  readonly glyphId: number;
  readonly sourceBytes: number;
  readonly storageOffset: number;
  readonly storageTexels: number;
  readonly extents: readonly [number, number, number, number];
}

export interface HbGpuFixtureBundle {
  readonly glyphs: readonly HbGpuFixtureGlyph[];
  /** RGBA16I is widened exactly as the upstream WebGPU demo requires. */
  readonly storage: Int32Array;
  readonly sourceBytes: number;
  readonly gpuBytes: number;
}

const readI16 = (view: DataView, texel: number, component: number) =>
  view.getInt16(texel * TEXEL_BYTES + component * 2, true);

const validateEncodedGlyph = (bytes: Uint8Array) => {
  if (bytes.byteLength < TEXEL_BYTES * 2 || bytes.byteLength % TEXEL_BYTES !== 0) {
    throw new TypeError('hb-gpu glyph blob must contain complete RGBA16I header texels.');
  }
  const texels = bytes.byteLength / TEXEL_BYTES;
  if (texels > TEXT_RENDERER_BAKEOFF_LIMITS.maximumHbGpuTexelsPerGlyph) {
    throw new TextRendererResourceLimitError('hb-gpu glyph exceeds the texel limit.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const horizontalBands = readI16(view, 1, 0);
  const verticalBands = readI16(view, 1, 1);
  if (horizontalBands < 1 || horizontalBands > MAX_BANDS
    || verticalBands < 1 || verticalBands > MAX_BANDS
    || 2 + horizontalBands + verticalBands > texels) {
    throw new TypeError('hb-gpu glyph has invalid band headers.');
  }
  for (let band = 0; band < horizontalBands + verticalBands; band += 1) {
    const headerTexel = 2 + band;
    const curveCount = readI16(view, headerTexel, 0);
    if (curveCount < 0 || curveCount > MAX_CURVES_PER_BAND) {
      throw new TextRendererResourceLimitError('hb-gpu band curve count exceeds the shader-loop limit.');
    }
    for (const component of [1, 2]) {
      const indexOffset = readI16(view, headerTexel, component) + 32_768;
      if (indexOffset < 0 || indexOffset + curveCount > texels) {
        throw new TypeError('hb-gpu band index range escapes the glyph blob.');
      }
      for (let index = 0; index < curveCount; index += 1) {
        const curveOffset = readI16(view, indexOffset + index, 0) + 32_768;
        if (curveOffset < 0 || curveOffset + 1 >= texels) {
          throw new TypeError('hb-gpu curve range escapes the glyph blob.');
        }
      }
    }
  }
};

export const parseHbGpuFixtureBundle = (input: Uint8Array): HbGpuFixtureBundle => {
  if (input.byteLength < 12 || !MAGIC.every((value, index) => input[index] === value)) {
    throw new TypeError('Invalid LightTable hb-gpu fixture header.');
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const glyphCount = view.getUint32(8, true);
  if (glyphCount > TEXT_RENDERER_BAKEOFF_LIMITS.maximumGlyphs) {
    throw new TextRendererResourceLimitError('hb-gpu fixture glyph count exceeds the bakeoff limit.');
  }
  let cursor = 12;
  let storageTexels = 0;
  const records: Array<{ glyphId: number; bytes: Uint8Array; extents: readonly [number, number, number, number] }> = [];
  const glyphIds = new Set<number>();
  for (let index = 0; index < glyphCount; index += 1) {
    if (cursor + RECORD_HEADER_BYTES > input.byteLength) throw new TypeError('Truncated hb-gpu fixture record.');
    const glyphId = view.getUint32(cursor, true);
    const length = view.getUint32(cursor + 4, true);
    const extents = [
      view.getInt32(cursor + 8, true), view.getInt32(cursor + 12, true),
      view.getInt32(cursor + 16, true), view.getInt32(cursor + 20, true)
    ] as const;
    cursor += RECORD_HEADER_BYTES;
    if (glyphIds.has(glyphId)) throw new TypeError('Duplicate glyph in hb-gpu fixture bundle.');
    glyphIds.add(glyphId);
    if (length % TEXEL_BYTES !== 0 || cursor + length > input.byteLength) {
      throw new TypeError('Truncated or misaligned hb-gpu glyph blob.');
    }
    const bytes = input.subarray(cursor, cursor + length);
    if (length > 0) validateEncodedGlyph(bytes);
    storageTexels += length / TEXEL_BYTES;
    if (storageTexels * 16 > TEXT_RENDERER_BAKEOFF_LIMITS.maximumHbGpuBytes) {
      throw new TextRendererResourceLimitError('hb-gpu storage buffer exceeds the bakeoff limit.');
    }
    records.push({ glyphId, bytes, extents });
    cursor += length;
  }
  if (cursor !== input.byteLength) throw new TypeError('hb-gpu fixture has trailing bytes.');
  const storage = new Int32Array(storageTexels * 4);
  const glyphs: HbGpuFixtureGlyph[] = [];
  let storageOffset = 0;
  for (const record of records) {
    const source = new DataView(record.bytes.buffer, record.bytes.byteOffset, record.bytes.byteLength);
    const texels = record.bytes.byteLength / TEXEL_BYTES;
    for (let texel = 0; texel < texels; texel += 1) {
      for (let component = 0; component < 4; component += 1) {
        storage[(storageOffset + texel) * 4 + component] = readI16(source, texel, component);
      }
    }
    glyphs.push({
      glyphId: record.glyphId,
      sourceBytes: record.bytes.byteLength,
      storageOffset,
      storageTexels: texels,
      extents: record.extents
    });
    storageOffset += texels;
  }
  return {
    glyphs,
    storage,
    sourceBytes: input.byteLength,
    gpuBytes: storage.byteLength
  };
};

/** Revalidates mutable widened storage and returns an owned GPU upload copy. */
export const copyValidatedHbGpuStorage = (bundle: HbGpuFixtureBundle) => {
  if (bundle.storage.byteLength !== bundle.gpuBytes
    || bundle.gpuBytes > TEXT_RENDERER_BAKEOFF_LIMITS.maximumHbGpuBytes) {
    throw new TextRendererResourceLimitError('hb-gpu storage buffer is invalid or oversized.');
  }
  let expectedOffset = 0;
  for (const glyph of bundle.glyphs) {
    if (glyph.storageOffset !== expectedOffset || glyph.storageTexels < 0
      || glyph.storageOffset + glyph.storageTexels > bundle.storage.length / 4) {
      throw new TypeError('hb-gpu glyph storage ranges are not contiguous and bounded.');
    }
    if (glyph.storageTexels > 0) {
      const encoded = new Uint8Array(glyph.storageTexels * TEXEL_BYTES);
      const view = new DataView(encoded.buffer);
      for (let texel = 0; texel < glyph.storageTexels; texel += 1) {
        for (let component = 0; component < 4; component += 1) {
          const value = bundle.storage[(glyph.storageOffset + texel) * 4 + component];
          if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
            throw new TypeError('hb-gpu widened storage contains a non-I16 component.');
          }
          view.setInt16(texel * TEXEL_BYTES + component * 2, value, true);
        }
      }
      validateEncodedGlyph(encoded);
    }
    expectedOffset += glyph.storageTexels;
  }
  if (expectedOffset * 4 !== bundle.storage.length) {
    throw new TypeError('hb-gpu storage contains unreferenced texels.');
  }
  return new Int32Array(bundle.storage);
};
