import type { PhotoshopAdjustmentSettings } from '../photoshopAdjustments';
import {
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS,
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_LUT_BASE64,
  PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE,
  PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_KNOTS,
  PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_LUT_BASE64
} from './photoshopColorVibranceLut.generated';

export { PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE } from './photoshopColorVibranceLut.generated';

export interface PhotoshopColorVibranceLuts {
  readonly whiteBalance: Float32Array<ArrayBuffer>;
  readonly color: Uint8Array<ArrayBuffer>;
}

const RGB_TABLE_BYTES = PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3 * 3;
const RGBA_TABLE_BYTES = PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3 * 4;
let decodedWhiteBalanceTables: Int16Array<ArrayBuffer> | null = null;
let decodedColorTables: Uint8Array<ArrayBuffer> | null = null;

const decodeBytes = (base64: string) => {
  const binary = atob(base64);
  const decoded = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
  return decoded;
};

const whiteBalanceTables = () => {
  if (decodedWhiteBalanceTables) return decodedWhiteBalanceTables;
  const bytes = decodeBytes(PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_LUT_BASE64);
  decodedWhiteBalanceTables = new Int16Array(bytes.buffer);
  return decodedWhiteBalanceTables;
};

const colorTables = () => {
  if (decodedColorTables) return decodedColorTables;
  decodedColorTables = decodeBytes(PHOTOSHOP_COLOR_VIBRANCE_COLOR_LUT_BASE64);
  return decodedColorTables;
};

const bracket = (knots: readonly number[], value: number) => {
  const clamped = Math.max(knots[0]!, Math.min(knots.at(-1)!, value));
  for (let lower = 0; lower < knots.length - 1; lower += 1) {
    const left = knots[lower]!;
    const right = knots[lower + 1]!;
    if (clamped > right) continue;
    return { lower, upper: lower + 1, amount: (clamped - left) / (right - left) };
  }
  const last = knots.length - 1;
  return { lower: last, upper: last, amount: 0 };
};

const interpolateGroup = <T extends Int16Array<ArrayBuffer> | Uint8Array<ArrayBuffer>>(
  knots: readonly number[],
  firstValue: number,
  secondValue: number,
  source: T,
  result: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>,
  scale: number,
  clampSource = false
) => {
  const first = bracket(knots, firstValue);
  const second = bracket(knots, secondValue);
  const stride = knots.length;
  const tableIndexes = [
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
  for (let voxel = 0; voxel < PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3; voxel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const withinTable = voxel * 3 + channel;
      let value = 0;
      for (let corner = 0; corner < 4; corner += 1) {
        const sample = source[tableIndexes[corner]! * RGB_TABLE_BYTES + withinTable]!;
        value += (clampSource ? Math.max(0, Math.min(255, sample)) : sample) * weights[corner]!;
      }
      result[voxel * 4 + channel] = result instanceof Float32Array
        ? value * scale
        : Math.round(value * scale);
    }
    result[voxel * 4 + 3] = result instanceof Float32Array ? 1 : 255;
  }
  return result;
};

/**
 * Builds the two coupled response volumes used by Photoshop 27's current
 * Color and Vibrance adjustment. Adobe evaluates Temperature/Tint together,
 * followed by a coupled Vibrance/Saturation stage; treating the four sliders
 * as independent transforms loses both gamut falloff and skin protection.
 */
export const buildPhotoshopColorVibranceLuts = (
  settings: PhotoshopAdjustmentSettings
): PhotoshopColorVibranceLuts => ({
  whiteBalance: interpolateGroup(
    PHOTOSHOP_COLOR_VIBRANCE_WHITE_BALANCE_KNOTS,
    settings.colorVibranceTemperature,
    settings.colorVibranceTint,
    whiteBalanceTables(),
    new Float32Array(RGBA_TABLE_BYTES),
    1 / 255,
    settings.colorVibranceVibrance === 0 && settings.colorVibranceSaturation === 0
  ) as Float32Array<ArrayBuffer>,
  color: interpolateGroup(
    PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS,
    settings.colorVibranceVibrance,
    settings.colorVibranceSaturation,
    colorTables(),
    new Uint8Array(RGBA_TABLE_BYTES),
    1
  ) as Uint8Array<ArrayBuffer>
});
