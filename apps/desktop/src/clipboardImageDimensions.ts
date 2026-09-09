export interface ClipboardImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ClipboardImageDimensionSource {
  availableFormats(): readonly string[];
  readBuffer(format: string): Uint8Array;
}

const dimension = (width: number, height: number): ClipboardImageDimensions | null => {
  const normalizedHeight = Math.abs(height);
  return Number.isSafeInteger(width) && Number.isSafeInteger(normalizedHeight)
    && width > 0 && normalizedHeight > 0
    ? { width, height: normalizedHeight }
    : null;
};

const dibDimensions = (bytes: Uint8Array) => {
  const dibOffset = bytes.byteLength >= 18 && bytes[0] === 0x42 && bytes[1] === 0x4d ? 14 : 0;
  if (bytes.byteLength < dibOffset + 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(dibOffset, true);
  if (headerSize === 12) {
    return dimension(view.getUint16(dibOffset + 4, true), view.getUint16(dibOffset + 6, true));
  }
  if (headerSize < 40 || bytes.byteLength < dibOffset + 12) return null;
  return dimension(view.getInt32(dibOffset + 4, true), view.getInt32(dibOffset + 8, true));
};

const parserForFormat = (format: string) => {
  const normalized = format.toLowerCase();
  const encodedPriority = encodedClipboardImageFormatPriority(format);
  if (encodedPriority !== null) return {
    parser: encodedClipboardImageDimensions,
    priority: encodedPriority
  };
  if (normalized.includes('dib') || normalized.includes('bitmap') || normalized.includes('bmp')) {
    return { parser: dibDimensions, priority: 100 };
  }
  return null;
};

/**
 * Chooses the cheapest supported clipboard payload and parses its container
 * header without decoding pixels. Electron still materializes the selected
 * payload; encoded formats are therefore preferred over potentially huge DIBs.
 */
export const readClipboardImageDimensions = (
  source: ClipboardImageDimensionSource
): ClipboardImageDimensions | null => {
  let formats: readonly string[];
  try {
    formats = source.availableFormats();
  } catch {
    return null;
  }
  const seen = new Set<string>();
  const candidates = formats
    .filter((format) => {
      const normalized = format.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((format) => ({ format, descriptor: parserForFormat(format) }))
    .filter((candidate): candidate is {
      format: string;
      descriptor: {
        parser: (bytes: Uint8Array) => ClipboardImageDimensions | null;
        priority: number;
      };
    } => candidate.descriptor !== null)
    .sort((left, right) => left.descriptor.priority - right.descriptor.priority);

  for (const { format, descriptor } of candidates) {
    try {
      const result = descriptor.parser(source.readBuffer(format));
      if (result) return result;
    } catch {
      // Delayed-rendering clipboard providers can advertise formats that fail
      // when requested. Continue to another format or the native fallback.
    }
  }
  return null;
};
import {
  encodedClipboardImageDimensions,
  encodedClipboardImageFormatPriority
} from './clipboardEncodedImage';
