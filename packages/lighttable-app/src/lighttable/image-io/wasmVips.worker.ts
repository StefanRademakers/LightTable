/// <reference lib="webworker" />

import Vips from 'wasm-vips';
import vipsWasmUrl from 'wasm-vips/vips.wasm?url';
import type { AdvancedSourceImageDescriptor, DecodedPixelStorage } from './types';
import type { WasmVipsWorkerRequest, WasmVipsWorkerResponse } from './wasmVipsProtocol';

let vipsPromise: ReturnType<typeof Vips> | null = null;

const getVips = () => {
  vipsPromise ??= Vips({
    // Keep optional HEIF/JXL side modules out of the initial spike. They can be
    // enabled independently after the base PNG/TIFF path is validated.
    dynamicLibraries: [],
    locateFile: (file) => file === 'vips.wasm' ? vipsWasmUrl : file
  });
  return vipsPromise;
};

const storageForFormat = (format: string): {
  storage: DecodedPixelStorage;
  bitDepth: 8 | 16 | 32;
  cast: 'uchar' | 'ushort' | 'float';
  alphaMax: number;
} => {
  if (format === 'uchar') return { storage: 'u8', bitDepth: 8, cast: 'uchar', alphaMax: 255 };
  if (format === 'ushort') return { storage: 'u16', bitDepth: 16, cast: 'ushort', alphaMax: 65535 };
  return { storage: 'f32', bitDepth: 32, cast: 'float', alphaMax: 1 };
};

const copyBuffer = (value: ArrayBufferView) => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
};

const decode = async (
  bytes: ArrayBuffer,
  contentType: string
): Promise<{ pixels: ArrayBuffer; descriptor: AdvancedSourceImageDescriptor }> => {
  const vips = await getVips();
  const owned: Vips.Image[] = [];
  const own = (image: Vips.Image) => {
    owned.push(image);
    return image;
  };

  try {
    const loaded = own(vips.Image.newFromBuffer(new Uint8Array(bytes), '', {
      access: 'sequential'
    }));
    const sourceFormat = loaded.format;
    const sourceInterpretation = loaded.interpretation;
    const sourceStorage = storageForFormat(sourceFormat);
    if (sourceStorage.storage === 'f32') {
      throw new Error(`Floating-point ${sourceFormat} image ingest is not enabled yet.`);
    }
    const fields = new Set(Array.from(loaded.getFields()));
    const icc = fields.has('icc-profile-data') ? copyBuffer(loaded.getBlob('icc-profile-data')) : null;
    const oriented = own(loaded.autorot());
    // Convert embedded device profiles to the working sRGB device space before
    // exposing pixels to WebGPU. LittleCMS runs inside the optional worker and
    // the requested output depth keeps 16-bit sources out of an 8-bit detour.
    const colorManaged = icc
      ? own(oriented.iccTransform('srgb', {
          embedded: true,
          intent: vips.Intent.relative,
          black_point_compensation: true,
          depth: sourceStorage.bitDepth
        }))
      : oriented;
    const outputStorage = storageForFormat(colorManaged.format);
    const { storage, cast, alphaMax } = outputStorage;
    const castImage = colorManaged.format === cast ? colorManaged : own(colorManaged.cast(cast));
    let rgba: Vips.Image;

    if (castImage.bands === 1) {
      const rgb = own(castImage.bandjoin([castImage, castImage]));
      rgba = own(rgb.bandjoin(alphaMax));
    } else if (castImage.bands === 2) {
      const gray = own(castImage.extractBand(0));
      const alpha = own(castImage.extractBand(1));
      rgba = own(gray.bandjoin([gray, gray, alpha]));
    } else if (castImage.bands === 3) {
      rgba = own(castImage.bandjoin(alphaMax));
    } else {
      rgba = own(castImage.extractBand(0, { n: 4 }));
    }

    const memory = rgba.writeToMemory();
    const pixels = copyBuffer(memory);
    return {
      pixels,
      descriptor: {
        width: rgba.width,
        height: rgba.height,
        channels: 4,
        storage,
        colorSpace: 'srgb',
        transferFunction: 'srgb',
        alphaMode: loaded.hasAlpha() ? 'straight' : 'none',
        orientationApplied: true,
        sourceBitDepth: sourceStorage.bitDepth,
        contentType,
        sourceFormat,
        sourceInterpretation,
        sourceProfile: icc ? 'embedded-icc-to-srgb' : 'assumed-srgb',
        iccProfile: icc,
        iccProfileAppliedToSrgb: Boolean(icc)
      }
    };
  } finally {
    for (let index = owned.length - 1; index >= 0; index -= 1) owned[index].delete();
  }
};

self.onmessage = async ({ data }: MessageEvent<WasmVipsWorkerRequest>) => {
  if (data.kind !== 'decode') return;
  let response: WasmVipsWorkerResponse;
  try {
    const result = await decode(data.bytes, data.contentType);
    response = { kind: 'decoded', requestId: data.requestId, ...result };
    const transfer = [result.pixels];
    if (result.descriptor.iccProfile) transfer.push(result.descriptor.iccProfile);
    self.postMessage(response, { transfer });
  } catch (error) {
    response = {
      kind: 'error',
      requestId: data.requestId,
      message: error instanceof Error ? error.message : 'The precision-preserving image decode failed.'
    };
    self.postMessage(response);
  }
};
