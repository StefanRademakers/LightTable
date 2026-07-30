import type { PixelArray } from 'ag-psd';

const linearToSrgb = (value: number) =>
  value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

/**
 * ag-psd preserves 8/16/32-bit composite pixels when `useImageData` is used.
 * Browser canvases are 8-bit, so this conversion is only for the embedded
 * Photoshop preview. The original PSD bytes remain the authoritative source.
 */
export const psdCompositeToPreviewPixels = (
  source: PixelArray,
  bitsPerChannel: number
) => {
  const output = new Uint8ClampedArray(source.length);
  if (bitsPerChannel === 8) {
    output.set(source as Uint8Array);
    return output;
  }
  if (bitsPerChannel === 16) {
    for (let index = 0; index < source.length; index += 1) {
      output[index] = byte(Number(source[index]) / 257);
    }
    return output;
  }
  if (bitsPerChannel === 32) {
    for (let index = 0; index < source.length; index += 4) {
      output[index] = byte(linearToSrgb(Math.max(0, Number(source[index]))) * 255);
      output[index + 1] = byte(linearToSrgb(Math.max(0, Number(source[index + 1]))) * 255);
      output[index + 2] = byte(linearToSrgb(Math.max(0, Number(source[index + 2]))) * 255);
      output[index + 3] = byte(Math.max(0, Math.min(1, Number(source[index + 3]))) * 255);
    }
    return output;
  }
  throw new Error(`Unsupported PSD channel depth: ${bitsPerChannel}-bit.`);
};

