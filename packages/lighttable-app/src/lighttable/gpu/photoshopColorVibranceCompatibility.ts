import compatibilityUrl from '../../assets/color-vibrance/photoshop-temperature-tint-v2.bin?url';

export const PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE = 9;
export const PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE = 17;
export const PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_KNOTS = Array.from(
  { length: 21 }, (_, index) => index * 10 - 100
);
export const PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS = [-100, -80, -20, 0, 20, 80, 100] as const;
export const PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_CODES = 64;
export const PHOTOSHOP_COLOR_VIBRANCE_HEADROOM_QUANTIZATION = 1.5;

const WHITE_BALANCE_TABLE_BYTES = PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE ** 3 * 3;
const COLOR_TABLE_BYTES = PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE ** 3 * 3;
const WHITE_BALANCE_BYTES = PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_KNOTS.length ** 2
  * WHITE_BALANCE_TABLE_BYTES;
const EXPECTED_BYTES = WHITE_BALANCE_BYTES
  + PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS.length ** 2 * COLOR_TABLE_BYTES;
let loaded: Uint8Array<ArrayBuffer> | null = null;
let pending: Promise<Uint8Array<ArrayBuffer>> | null = null;

export const loadedPhotoshopColorVibranceCompatibility = () => loaded;

export const loadPhotoshopColorVibranceCompatibility = () => {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  pending = fetch(compatibilityUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Color and Vibrance compatibility load failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    if (bytes.length !== EXPECTED_BYTES) {
      throw new Error(`Color and Vibrance compatibility has ${bytes.length} bytes; expected ${EXPECTED_BYTES}.`);
    }
    loaded = bytes;
    return bytes;
  }).finally(() => { pending = null; });
  return pending;
};

const bracket = (knots: readonly number[], value: number) => {
  const clamped = Math.max(knots[0]!, Math.min(knots.at(-1)!, value));
  for (let lower = 0; lower < knots.length - 1; lower += 1) {
    if (clamped > knots[lower + 1]!) continue;
    return {
      lower,
      upper: lower + 1,
      amount: (clamped - knots[lower]!) / (knots[lower + 1]! - knots[lower]!)
    };
  }
  return { lower: knots.length - 2, upper: knots.length - 1, amount: 1 };
};

const interpolate = (
  bytes: Uint8Array,
  knots: readonly number[],
  firstValue: number,
  secondValue: number,
  sourceOffset: number,
  volumeSize: number,
  tableBytes: number
) => {
  if (bytes.length !== EXPECTED_BYTES) throw new Error('Invalid Color and Vibrance compatibility data.');
  const first = bracket(knots, firstValue);
  const second = bracket(knots, secondValue);
  const stride = knots.length;
  const tables = [
    first.lower * stride + second.lower,
    first.upper * stride + second.lower,
    first.lower * stride + second.upper,
    first.upper * stride + second.upper
  ];
  const weights = [
    (1 - first.amount) * (1 - second.amount),
    first.amount * (1 - second.amount),
    (1 - first.amount) * second.amount,
    first.amount * second.amount
  ];
  const result = new Uint8Array(volumeSize ** 3 * 4);
  for (let voxel = 0; voxel < volumeSize ** 3; voxel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const withinTable = voxel * 3 + channel;
      let value = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        value += bytes[sourceOffset + tables[corner]! * tableBytes + withinTable]!
          * weights[corner]!;
      }
      result[voxel * 4 + channel] = Math.round(value);
    }
    result[voxel * 4 + 3] = 255;
  }
  return result;
};

/** Interpolates only active volumes; the 1.61 MiB corpus never enters WGSL or a JS bundle. */
export const buildPhotoshopColorVibranceCompatibility = (
  bytes: Uint8Array, temperature: number, tint: number
) => interpolate(
  bytes, PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_KNOTS, temperature, tint, 0,
  PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE, WHITE_BALANCE_TABLE_BYTES
);

export const buildPhotoshopColorVibranceColorCompatibility = (
  bytes: Uint8Array, vibrance: number, saturation: number
) => interpolate(
  bytes, PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS, vibrance, saturation, WHITE_BALANCE_BYTES,
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE, COLOR_TABLE_BYTES
);
