import type { LightTableImageDecodeMode } from '../rendering/rendererTypes';

const LIGHTTABLE_FOOTER_MAGIC = 'LTBLDOC1';
const LIGHTTABLE_FOOTER_SIZE = 12;
const HEADER_SIZE = 4_096;
const MAXIMUM_PIXEL_EDGE = 32_768;
const MAXIMUM_PIXEL_COUNT = 268_435_456;
const MAXIMUM_JPEG_METADATA_BYTES = 64 * 1024 * 1024;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

export type DocumentSourceFormat =
  | 'lighttable'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'tiff'
  | 'psd'
  | 'psb'
  | 'pdf'
  | 'svg'
  | 'unknown';

export type DocumentSourceCodec =
  | 'lighttable'
  | 'browser-native'
  | 'wasm-vips'
  | 'photoshop'
  | 'pdf-raster'
  | 'svg-native'
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

const assertSafeRasterDimensions = (width: number, height: number) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > MAXIMUM_PIXEL_EDGE || height > MAXIMUM_PIXEL_EDGE
    || width * height > MAXIMUM_PIXEL_COUNT) {
    throw new Error(
      `Image dimensions ${width} × ${height} exceed LightTable's safe raster decode limit.`
    );
  }
};

const assertPngDimensions = (header: Uint8Array) => {
  if (header.length < 24 || asciiAt(header, 12, 4) !== 'IHDR') return;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  assertSafeRasterDimensions(view.getUint32(16, false), view.getUint32(20, false));
};

const assertWebpDimensions = (header: Uint8Array) => {
  if (header.length < 30) return;
  const kind = asciiAt(header, 12, 4);
  if (kind === 'VP8X') {
    const width = 1 + header[24]! + (header[25]! << 8) + (header[26]! << 16);
    const height = 1 + header[27]! + (header[28]! << 8) + (header[29]! << 16);
    assertSafeRasterDimensions(width, height);
  } else if (kind === 'VP8L' && header[20] === 0x2f && header.length >= 25) {
    const bits = new DataView(header.buffer, header.byteOffset + 21, 4).getUint32(0, true);
    assertSafeRasterDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  } else if (kind === 'VP8 ' && header.length >= 30
    && bytesEqual(header, 23, [0x9d, 0x01, 0x2a])) {
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    assertSafeRasterDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
};

const assertJpegDimensions = async (blob: Blob) => {
  let offset = 2;
  for (let segment = 0; segment < 4_096 && offset < blob.size; segment += 1) {
    if (offset > MAXIMUM_JPEG_METADATA_BYTES) {
      throw new Error('JPEG metadata exceeds LightTable\'s 64 MiB inspection limit.');
    }
    const markerBytes = new Uint8Array(
      await blob.slice(offset, Math.min(blob.size, offset + 32)).arrayBuffer()
    );
    let markerOffset = 0;
    while (markerOffset < markerBytes.length && markerBytes[markerOffset] !== 0xff) markerOffset += 1;
    while (markerOffset < markerBytes.length && markerBytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= markerBytes.length) return;
    const marker = markerBytes[markerOffset]!;
    offset += markerOffset + 1;
    if (marker === 0xd9 || marker === 0xda) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const lengthBytes = new Uint8Array(await blob.slice(offset, offset + 2).arrayBuffer());
    if (lengthBytes.length !== 2) return;
    const length = (lengthBytes[0]! << 8) | lengthBytes[1]!;
    if (length < 2 || offset + length > blob.size) return;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      const dimensions = new Uint8Array(await blob.slice(offset + 2, offset + 7).arrayBuffer());
      if (dimensions.length !== 5) return;
      assertSafeRasterDimensions(
        (dimensions[3]! << 8) | dimensions[4]!,
        (dimensions[1]! << 8) | dimensions[2]!
      );
      return;
    }
    offset += length;
  }
};

const readChunkHeader = async (blob: Blob, offset: number) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > blob.size) return null;
  const bytes = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
  return bytes.length === 8 ? bytes : null;
};

const pngIsAnimated = async (blob: Blob) => {
  let offset = 8;
  for (let chunk = 0; chunk < 4_096; chunk += 1) {
    const header = await readChunkHeader(blob, offset);
    if (!header) return false;
    const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, false);
    const type = asciiAt(header, 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next <= offset || next > blob.size) return false;
    offset = next;
  }
  throw new Error('This PNG contains too many chunks to inspect safely.');
};

const webpIsAnimated = async (blob: Blob) => {
  let offset = 12;
  for (let chunk = 0; chunk < 4_096; chunk += 1) {
    const header = await readChunkHeader(blob, offset);
    if (!header) return false;
    const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, true);
    const type = asciiAt(header, 0, 4);
    if (type === 'ANIM' || type === 'ANMF') return true;
    if (type === 'VP8X' && length >= 1) {
      const flags = new Uint8Array(await blob.slice(offset + 8, offset + 9).arrayBuffer())[0] ?? 0;
      if ((flags & 0x02) !== 0) return true;
    }
    if (type === 'VP8 ' || type === 'VP8L') return false;
    const next = offset + 8 + length + (length & 1);
    if (!Number.isSafeInteger(next) || next <= offset || next > blob.size) return false;
    offset = next;
  }
  throw new Error('This WebP contains too many chunks to inspect safely.');
};

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
    assertPngDimensions(header);
    if (await pngIsAnimated(blob)) {
      throw new Error('Animated PNG cannot be opened safely yet because animation editing is unavailable.');
    }
    const bitDepth = header.length > 24 ? header[24] ?? null : null;
    return nativeProbe(
      'png',
      bitDepth,
      requestedMode === 'preserve-precision' ? requestedMode : 'fast'
    );
  }

  if (bytesEqual(header, 0, [0xff, 0xd8, 0xff])) {
    await assertJpegDimensions(blob);
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
    assertWebpDimensions(header);
    if (await webpIsAnimated(blob)) {
      throw new Error('Animated WebP cannot be opened safely yet because animation editing is unavailable.');
    }
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

  if (asciiAt(header, 0, 5) === '%PDF-') {
    return {
      format: 'pdf',
      codec: 'pdf-raster',
      decodeMode: 'fast',
      bitDepth: null
    };
  }

  let textPrefix = new TextDecoder('utf-8', { fatal: false }).decode(header)
    .replace(/^\uFEFF?\s*/u, '')
    .replace(/^<\?xml[^?]*\?>\s*/iu, '');
  // XML permits comments between the declaration and the document element.
  // Inkscape commonly writes its authoring signature there, so discard only
  // complete leading comments while keeping the byte probe bounded.
  while (/^<!--/u.test(textPrefix)) {
    const next = textPrefix.replace(/^<!--[\s\S]*?-->\s*/u, '');
    if (next === textPrefix) break;
    textPrefix = next;
  }
  if (/^<svg(?:\s|>)/iu.test(textPrefix)) {
    return { format: 'svg', codec: 'svg-native', decodeMode: 'fast', bitDepth: null };
  }

  return {
    format: 'unknown',
    codec: 'unsupported',
    decodeMode: 'fast',
    bitDepth: null
  };
};
