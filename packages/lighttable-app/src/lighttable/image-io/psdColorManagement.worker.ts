import Vips from 'wasm-vips';
import vipsWasmUrl from 'wasm-vips/vips.wasm?url';
import type { PsdColorProfileInfo } from './psdColorProfile';

export interface PsdPixelNormalizer {
  readonly normalizedToSrgb: boolean;
  readonly sourceProfile: 'srgb' | 'adobe-rgb-1998' | 'other';
  transform(
    pixels: Uint8ClampedArray | Uint16Array,
    width: number,
    height: number,
    bitDepth?: 8 | 16
  ): Promise<Uint8ClampedArray | Uint16Array>;
}

const isSrgb = (name: string | null) => Boolean(name && /\bsrgb\b/i.test(name));

const copyBytes = (source: ArrayBufferView) => {
  const copy = new Uint8Array(source.byteLength);
  copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return copy;
};

const copyClampedBytes = (source: ArrayBufferView) => {
  const copy = new Uint8ClampedArray(source.byteLength);
  copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return copy;
};

const copyWords = (source: ArrayBufferView) => {
  const bytes = copyBytes(source);
  const words = new Uint16Array(bytes.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  new Uint8Array(words.buffer).set(bytes);
  return words;
};

const identity: PsdPixelNormalizer = {
  normalizedToSrgb: true,
  sourceProfile: 'srgb',
  transform: async (pixels) => pixels
};

/**
 * Creates one document-scoped LittleCMS transform. The PSD worker is already
 * lazy, and wasm-vips itself is instantiated only for an embedded non-sRGB
 * profile. Every pixel-bearing document resource uses this same boundary.
 */
export const createPsdPixelNormalizer = async (
  profile: PsdColorProfileInfo
): Promise<PsdPixelNormalizer> => {
  if (profile.disposition === 'untagged' || !profile.bytes || isSrgb(profile.name)) return identity;
  const vips = await Vips({
    dynamicLibraries: [],
    locateFile: (file) => file === 'vips.wasm' ? vipsWasmUrl : file
  });
  const profileBytes = copyBytes(profile.bytes);
  return {
    normalizedToSrgb: true,
    sourceProfile: /adobe\s*rgb/i.test(profile.name ?? '') ? 'adobe-rgb-1998' : 'other',
    transform: async (pixels, width, height, bitDepth = 8) => {
      const input = vips.Image.newFromMemory(
        copyBytes(pixels),
        width,
        height,
        4,
        bitDepth === 16 ? vips.BandFormat.ushort : vips.BandFormat.uchar
      );
      const taggedInput = input.copy({
        interpretation: bitDepth === 16
          ? vips.Interpretation.rgb16
          : vips.Interpretation.srgb
      });
      let output: Vips.Image | null = null;
      try {
        taggedInput.setBlob('icc-profile-data', profileBytes);
        output = taggedInput.iccTransform('srgb', {
          embedded: true,
          intent: vips.Intent.relative,
          black_point_compensation: true,
          depth: bitDepth
        });
        return bitDepth === 16
          ? copyWords(output.writeToMemory())
          : copyClampedBytes(output.writeToMemory());
      } finally {
        output?.delete();
        taggedInput.delete();
        input.delete();
      }
    }
  };
};
