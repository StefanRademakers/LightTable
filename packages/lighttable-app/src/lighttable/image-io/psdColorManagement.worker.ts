import Vips from 'wasm-vips';
import vipsWasmUrl from 'wasm-vips/vips.wasm?url';
import type { PsdColorProfileInfo } from './psdColorProfile';

export interface PsdPixelNormalizer {
  readonly normalizedToSrgb: boolean;
  transform(pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8ClampedArray>;
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

const identity: PsdPixelNormalizer = {
  normalizedToSrgb: true,
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
    transform: async (pixels, width, height) => {
      const input = vips.Image.newFromMemory(copyBytes(pixels), width, height, 4, vips.BandFormat.uchar);
      const taggedInput = input.copy({ interpretation: vips.Interpretation.srgb });
      let output: Vips.Image | null = null;
      try {
        taggedInput.setBlob('icc-profile-data', profileBytes);
        output = taggedInput.iccTransform('srgb', {
          embedded: true,
          intent: vips.Intent.relative,
          black_point_compensation: true,
          depth: 8
        });
        return copyClampedBytes(output.writeToMemory());
      } finally {
        output?.delete();
        taggedInput.delete();
        input.delete();
      }
    }
  };
};
