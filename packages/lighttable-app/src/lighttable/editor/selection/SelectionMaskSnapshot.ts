import type { Rect } from '../document/documentTypes';
import type { SelectionCoverageBounds } from './selectionCoverage';

const SNAPSHOT_OVERHEAD_BYTES = 32;

export type SelectionMaskSnapshotEncoding = 'raw-r16float' | 'rle-r16float';

export interface SelectionTranslationLineage {
  readonly source: SelectionMaskSnapshot;
  readonly x: number;
  readonly y: number;
}

/**
 * Immutable, document-sized copy of the canonical GPU selection channel.
 *
 * Half-float words are kept verbatim so history, tab switches and rollback do
 * not quantize a feathered selection. Storage is run-length encoded only when
 * that is smaller than the original channel; noisy masks remain a raw copy.
 */
export class SelectionMaskSnapshot {
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly encoding: SelectionMaskSnapshotEncoding;
  readonly byteSize: number;
  readonly translation: SelectionTranslationLineage | null;

  readonly #raw: Uint16Array | null;
  readonly #runs: Uint32Array | null;
  readonly #supportBounds: Rect | null;

  private constructor(
    width: number,
    height: number,
    active: boolean,
    encoding: SelectionMaskSnapshotEncoding,
    raw: Uint16Array | null,
    runs: Uint32Array | null,
    supportBounds: Rect | null,
    translation: SelectionTranslationLineage | null = null
  ) {
    this.width = width;
    this.height = height;
    this.active = active;
    this.encoding = encoding;
    this.#raw = raw;
    this.#runs = runs;
    this.#supportBounds = supportBounds;
    this.translation = translation;
    this.byteSize = (raw?.byteLength ?? runs?.byteLength ?? 0) + SNAPSHOT_OVERHEAD_BYTES
      + (translation ? translation.source.byteSize : 0);
  }

  static inactive(width: number, height: number) {
    assertDimensions(width, height);
    return new SelectionMaskSnapshot(width, height, false, 'rle-r16float', null, null, null);
  }

  static fromRaw(width: number, height: number, values: Uint16Array) {
    assertDimensions(width, height);
    const expectedLength = width * height;
    if (values.length !== expectedLength) {
      throw new RangeError(
        `Selection snapshot expected ${expectedLength} half-float values, received ${values.length}.`
      );
    }
    const raw = new Uint16Array(values);
    const { runs, supportBounds } = encodeRuns(raw, width);
    return runs.byteLength < raw.byteLength
      ? new SelectionMaskSnapshot(width, height, true, 'rle-r16float', null, runs, supportBounds)
      : new SelectionMaskSnapshot(width, height, true, 'raw-r16float', raw, null, supportBounds);
  }

  /**
   * Retains the unshifted exact mask beside the clipped in-canvas realization.
   * A later nudge can therefore be derived from the original coverage plus the
   * cumulative displacement instead of translating already clipped texels.
   */
  withTranslation(source: SelectionMaskSnapshot, x: number, y: number) {
    if (!source.active) throw new Error('Selection translation requires active source coverage.');
    if (source.width !== this.width || source.height !== this.height) {
      throw new Error('Selection translation source dimensions do not match.');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Selection translation must be finite.');
    }
    const root = source.translation?.source ?? source;
    const rootX = source.translation?.x ?? 0;
    const rootY = source.translation?.y ?? 0;
    return new SelectionMaskSnapshot(
      this.width,
      this.height,
      this.active,
      this.encoding,
      this.#raw,
      this.#runs,
      this.#supportBounds,
      { source: root, x: rootX + x, y: rootY + y }
    );
  }

  /** Exact non-zero mask extent captured during the existing encoding pass. */
  measureSupportBounds(): Rect | null {
    return this.#supportBounds ? { ...this.#supportBounds } : null;
  }

  toRaw(): Uint16Array {
    if (!this.active) {
      throw new Error('An inactive selection does not contain mask pixels.');
    }
    if (this.#raw) return new Uint16Array(this.#raw);
    if (!this.#runs) throw new Error('The selection snapshot payload is unavailable.');
    return decodeRuns(this.#runs, this.width * this.height);
  }

  /** Samples exact committed coverage without allocating a decoded full-size copy. */
  contains(x: number, y: number): boolean {
    if (!this.active || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) return false;
    const target = row * this.width + column;
    if (this.#raw) return this.#raw[target] !== 0;
    if (!this.#runs) return false;
    let offset = 0;
    for (const run of this.#runs) {
      const length = (run & 0xffff) + 1;
      if (target < offset + length) return (run >>> 16) !== 0;
      offset += length;
    }
    return false;
  }

  /** Derives exact support/core bounds from the captured CPU mask without another GPU readback. */
  measureBounds(): SelectionCoverageBounds | null {
    if (!this.active) return null;
    let peak = 0;
    this.forEachValue((value) => {
      const coverage = halfFloatToNumber(value);
      if (Number.isFinite(coverage)) peak = Math.max(peak, coverage);
    });
    if (peak <= 0) return null;
    const scan = (threshold: number): Rect | null => {
      let minX = this.width;
      let minY = this.height;
      let maxX = -1;
      let maxY = -1;
      this.forEachValue((value, index) => {
        const coverage = halfFloatToNumber(value);
        if (!Number.isFinite(coverage) || coverage < threshold) return;
        const x = index % this.width;
        const y = Math.floor(index / this.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
      return maxX < minX || maxY < minY ? null : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
    };
    const supportBounds = this.measureSupportBounds();
    const coreBounds = scan(peak * 0.5);
    return supportBounds && coreBounds
      ? { supportBounds, coreBounds, peakCoverage: peak }
      : null;
  }

  private forEachValue(visit: (value: number, index: number) => void): void {
    if (this.#raw) {
      this.#raw.forEach(visit);
      return;
    }
    if (!this.#runs) return;
    let index = 0;
    for (const run of this.#runs) {
      const value = run >>> 16;
      const length = (run & 0xffff) + 1;
      for (let offset = 0; offset < length; offset += 1) visit(value, index++);
    }
  }
}

const halfFloatToNumber = (word: number): number => {
  const sign = (word & 0x8000) ? -1 : 1;
  const exponent = (word >>> 10) & 0x1f;
  const fraction = word & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + fraction / 0x400) * 2 ** (exponent - 15);
};

const assertDimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Selection snapshot dimensions must be positive integers.');
  }
};

const encodeRuns = (values: Uint16Array, width: number) => {
  if (values.length === 0) return { runs: new Uint32Array(), supportBounds: null };
  const encoded: number[] = [];
  let minX = width;
  let minY = Math.ceil(values.length / width);
  let maxX = -1;
  let maxY = -1;
  const includeSupportRun = (start: number, length: number) => {
    if (value === 0 || length === 0) return;
    const end = start + length - 1;
    const startX = start % width;
    const startY = Math.floor(start / width);
    const endX = end % width;
    const endY = Math.floor(end / width);
    minY = Math.min(minY, startY);
    maxY = Math.max(maxY, endY);
    if (startY === endY) {
      minX = Math.min(minX, startX);
      maxX = Math.max(maxX, endX);
    } else {
      // A contiguous run crossing a row boundary contains both the final
      // column of its first row and the first column of its last row.
      minX = 0;
      maxX = width - 1;
    }
  };
  let value = values[0]!;
  let runStart = 0;
  let length = 1;
  const flush = () => {
    includeSupportRun(runStart, length);
    while (length > 0) {
      const part = Math.min(length, 0x10000);
      encoded.push((value << 16) | (part - 1));
      length -= part;
    }
  };
  for (let index = 1; index < values.length; index += 1) {
    const next = values[index]!;
    if (next === value && length < 0x10000) {
      length += 1;
      continue;
    }
    flush();
    value = next;
    runStart = index;
    length = 1;
  }
  flush();
  return {
    runs: Uint32Array.from(encoded),
    supportBounds: maxX < minX || maxY < minY ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    }
  };
};

const decodeRuns = (runs: Uint32Array, expectedLength: number) => {
  const values = new Uint16Array(expectedLength);
  let offset = 0;
  for (const run of runs) {
    const value = run >>> 16;
    const length = (run & 0xffff) + 1;
    if (offset + length > expectedLength) {
      throw new Error('The selection snapshot contains more pixels than its document dimensions.');
    }
    values.fill(value, offset, offset + length);
    offset += length;
  }
  if (offset !== expectedLength) {
    throw new Error('The selection snapshot does not cover its complete document dimensions.');
  }
  return values;
};
