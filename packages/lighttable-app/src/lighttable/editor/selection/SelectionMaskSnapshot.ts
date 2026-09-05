const SNAPSHOT_OVERHEAD_BYTES = 32;

export type SelectionMaskSnapshotEncoding = 'raw-r16float' | 'rle-r16float';

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

  readonly #raw: Uint16Array | null;
  readonly #runs: Uint32Array | null;

  private constructor(
    width: number,
    height: number,
    active: boolean,
    encoding: SelectionMaskSnapshotEncoding,
    raw: Uint16Array | null,
    runs: Uint32Array | null
  ) {
    this.width = width;
    this.height = height;
    this.active = active;
    this.encoding = encoding;
    this.#raw = raw;
    this.#runs = runs;
    this.byteSize = (raw?.byteLength ?? runs?.byteLength ?? 0) + SNAPSHOT_OVERHEAD_BYTES;
  }

  static inactive(width: number, height: number) {
    assertDimensions(width, height);
    return new SelectionMaskSnapshot(width, height, false, 'rle-r16float', null, null);
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
    const runs = encodeRuns(raw);
    return runs.byteLength < raw.byteLength
      ? new SelectionMaskSnapshot(width, height, true, 'rle-r16float', null, runs)
      : new SelectionMaskSnapshot(width, height, true, 'raw-r16float', raw, null);
  }

  toRaw(): Uint16Array {
    if (!this.active) {
      throw new Error('An inactive selection does not contain mask pixels.');
    }
    if (this.#raw) return new Uint16Array(this.#raw);
    if (!this.#runs) throw new Error('The selection snapshot payload is unavailable.');
    return decodeRuns(this.#runs, this.width * this.height);
  }
}

const assertDimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Selection snapshot dimensions must be positive integers.');
  }
};

const encodeRuns = (values: Uint16Array) => {
  if (values.length === 0) return new Uint32Array();
  const encoded: number[] = [];
  let value = values[0]!;
  let length = 1;
  const flush = () => {
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
    length = 1;
  }
  flush();
  return Uint32Array.from(encoded);
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
