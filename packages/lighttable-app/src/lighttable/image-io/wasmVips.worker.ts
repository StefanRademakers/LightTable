/// <reference lib="webworker" />

import Vips from 'wasm-vips';
import vipsWasmUrl from 'wasm-vips/vips.wasm?url';
import type { AdvancedSourceImageDescriptor, DecodedPixelStorage } from './types';
import type { WasmVipsWorkerRequest, WasmVipsWorkerResponse } from './wasmVipsProtocol';
import { nativeBitmapFormat } from './nativeBitmapFormats';
import { halfFloatToNormalizedU16 } from './halfFloatPixels';

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

const encode = async (
  request: Extract<WasmVipsWorkerRequest, { kind: 'encode' }>
): Promise<ArrayBuffer> => {
  const { pixels, width, height, storage, format } = request;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('Bitmap encode dimensions are invalid.');
  }
  const definition = nativeBitmapFormat(format);
  const bitDepth = storage === 'u8' ? 8 : 16;
  if (!definition.writableBitDepths.includes(bitDepth)) {
    throw new Error(`${definition.label} does not support ${bitDepth}-bit LightTable output.`);
  }
  const expectedBytes = width * height * 4 * (storage === 'u8' ? 1 : 2);
  if (!Number.isSafeInteger(expectedBytes) || pixels.byteLength !== expectedBytes) {
    throw new Error('Bitmap encode pixel length does not match its dimensions.');
  }

  const vips = await getVips();
  const owned: Vips.Image[] = [];
  const own = (image: Vips.Image) => { owned.push(image); return image; };
  try {
    const memory = storage === 'f16-display'
      ? halfFloatToNormalizedU16(new Uint16Array(pixels))
      : storage === 'u16' ? new Uint16Array(pixels) : new Uint8Array(pixels);
    const source = own(vips.Image.newFromMemory(
      memory, width, height, 4, bitDepth === 16 ? vips.BandFormat.ushort : vips.BandFormat.uchar
    ));
    const interpreted = own(source.copy({ interpretation: vips.Interpretation.srgb }));
    let bytes: Uint8Array;
    switch (format) {
      case 'jpeg': {
        const flattened = own(interpreted.flatten({ background: [255, 255, 255] }));
        bytes = flattened.jpegsaveBuffer({
          Q: 92,
          optimize_coding: true,
          interlace: false,
          subsample_mode: vips.ForeignSubsample.auto
        });
        break;
      }
      case 'png':
        bytes = interpreted.pngsaveBuffer({ compression: 6, bitdepth: bitDepth });
        break;
      case 'webp':
        // Native editing defaults to lossless WebP so Save does not introduce
        // another lossy generation. Export UI may offer lossy quality later.
        bytes = interpreted.webpsaveBuffer({ lossless: true, Q: 100, effort: 0 });
        break;
      case 'tiff':
        bytes = interpreted.tiffsaveBuffer({
          compression: vips.ForeignTiffCompression.deflate,
          predictor: vips.ForeignTiffPredictor.horizontal,
          level: 6
        });
        break;
    }
    return copyBuffer(bytes);
  } finally {
    for (let index = owned.length - 1; index >= 0; index -= 1) owned[index].delete();
  }
};

self.onmessage = async ({ data }: MessageEvent<WasmVipsWorkerRequest>) => {
  let response: WasmVipsWorkerResponse;
  try {
    if (data.kind === 'encode') {
      const bytes = await encode(data);
      response = { kind: 'encoded', requestId: data.requestId, bytes };
      self.postMessage(response, { transfer: [bytes] });
    } else {
      const result = await decode(data.bytes, data.contentType);
      response = { kind: 'decoded', requestId: data.requestId, ...result };
      const transfer = [result.pixels];
      if (result.descriptor.iccProfile) transfer.push(result.descriptor.iccProfile);
      self.postMessage(response, { transfer });
    }
  } catch (error) {
    response = {
      kind: 'error',
      requestId: data.requestId,
      message: error instanceof Error ? error.message : 'The precision-preserving image decode failed.'
    };
    self.postMessage(response);
  }
};
