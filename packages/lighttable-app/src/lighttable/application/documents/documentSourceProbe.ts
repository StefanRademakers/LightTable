import type { LightTableImageDecodeMode } from '../rendering/rendererTypes';

const LIGHTTABLE_FOOTER_MAGIC = 'LTBLDOC1';
const LIGHTTABLE_FOOTER_SIZE = 12;
const HEADER_SIZE = 32;

export type DocumentSourceFormat =
  | 'lighttable'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'tiff'
  | 'psd'
  | 'psb'
  | 'unknown';

export type DocumentSourceCodec =
  | 'lighttable'
  | 'browser-native'
  | 'wasm-vips'
  | 'photoshop'
  | 'unsupported';

export type DocumentOpenMode =
  | 'automatic'
  | LightTableImageDecodeMode;

export interface DocumentSourceProbe {
  readonly format: DocumentSourceFormat;
  readonly codec: DocumentSourceCodec;
  readonly decodeMode: LightTableImageDecodeMode;
  readonly bitDepth: number | null;
}

const bytesEqual = (
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[]
) => expected.every((value, index) => bytes[offset + index] === value);

const asciiAt = (bytes: Uint8Array, offset: number, length: number) =>
  new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length));

const isTiffHeader = (header: Uint8Array) =>
  bytesEqual(header, 0, [0x49, 0x49, 0x2a, 0x00])
  || bytesEqual(header, 0, [0x4d, 0x4d, 0x00, 0x2a])
  || bytesEqual(header, 0, [0x49, 0x49, 0x2b, 0x00])
  || bytesEqual(header, 0, [0x4d, 0x4d, 0x00, 0x2b]);

const nativeProbe = (
  format: 'png' | 'jpeg' | 'webp',
  bitDepth: number | null,
  requestedMode: LightTableImageDecodeMode
): DocumentSourceProbe => {
  const preservePrecision =
    requestedMode === 'preserve-precision'
    || (format === 'png' && bitDepth !== null && bitDepth > 8);
  return {
    format,
    codec: preservePrecision ? 'wasm-vips' : 'browser-native',
    decodeMode: preservePrecision ? 'preserve-precision' : 'fast',
    bitDepth
  };
};

/**
 * Selects the import route from file signatures without loading any decoder.
 *
 * Extensions and MIME types intentionally do not participate: hosts may supply
 * empty or incorrect metadata, while the bytes are authoritative. Only a small
 * prefix and the LightTable footer are read, so ordinary browser-native images
 * remain on the cheap startup path.
 */
export const probeDocumentSource = async (
  blob: Blob,
  requestedMode: DocumentOpenMode = 'automatic'
): Promise<DocumentSourceProbe> => {
  const header = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, HEADER_SIZE)).arrayBuffer()
  );

  if (blob.size >= LIGHTTABLE_FOOTER_SIZE) {
    const footer = new Uint8Array(
      await blob.slice(blob.size - LIGHTTABLE_FOOTER_SIZE).arrayBuffer()
    );
    if (asciiAt(footer, 0, 8) === LIGHTTABLE_FOOTER_MAGIC) {
      return {
        format: 'lighttable',
        codec: 'lighttable',
        decodeMode: 'fast',
        bitDepth: null
      };
    }
  }

  if (bytesEqual(header, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const bitDepth = header.length > 24 ? header[24] ?? null : null;
    return nativeProbe(
      'png',
      bitDepth,
      requestedMode === 'preserve-precision' ? requestedMode : 'fast'
    );
  }

  if (bytesEqual(header, 0, [0xff, 0xd8, 0xff])) {
    return nativeProbe(
      'jpeg',
      8,
      requestedMode === 'preserve-precision' ? requestedMode : 'fast'
    );
  }

  if (
    asciiAt(header, 0, 4) === 'RIFF'
    && asciiAt(header, 8, 4) === 'WEBP'
  ) {
    return nativeProbe(
      'webp',
      8,
      requestedMode === 'preserve-precision' ? requestedMode : 'fast'
    );
  }

  if (isTiffHeader(header)) {
    return {
      format: 'tiff',
      codec: 'wasm-vips',
      decodeMode: 'preserve-precision',
      bitDepth: null
    };
  }

  if (asciiAt(header, 0, 4) === '8BPS' && header.length >= 24) {
    const version = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    ).getUint16(4, false);
    if (version === 1 || version === 2) {
      return {
        format: version === 2 ? 'psb' : 'psd',
        codec: 'photoshop',
        decodeMode: 'fast',
        bitDepth: new DataView(
          header.buffer,
          header.byteOffset,
          header.byteLength
        ).getUint16(22, false)
      };
    }
  }

  return {
    format: 'unknown',
    codec: 'unsupported',
    decodeMode: 'fast',
    bitDepth: null
  };
};
