export interface ClipboardEncodedImageSource {
  availableFormats(): string[];
  readBuffer(format: string): Uint8Array;
}

export interface PreferredClipboardImage {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';
  readonly sourceFormat: string;
}

export interface EncodedClipboardImageDimensions {
  readonly width: number;
  readonly height: number;
}

const MAX_CLIPBOARD_IMAGE_BYTES = 512 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.byteLength >= signature.length
  && signature.every((value, index) => bytes[index] === value);

export const encodedClipboardImageType = (
  bytes: Uint8Array
): PreferredClipboardImage['mediaType'] | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.byteLength >= 12
    && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return 'image/gif';
  }
  if (bytes.byteLength >= 12
    && startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])
    && ['avif', 'avis'].includes(new TextDecoder('ascii').decode(bytes.subarray(8, 12)))) {
    return 'image/avif';
  }
  return null;
};

export const encodedClipboardImageFormatPriority = (format: string) => {
  const normalized = format.toLowerCase();
  if (normalized.includes('png')) return 0;
  if (normalized.includes('webp')) return 1;
  if (normalized.includes('gif')) return 2;
  if (normalized.includes('avif')) return 3;
  return null;
};

const validDimensions = (width: number, height: number) =>
  Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;

/** Reads dimensions from a supported encoded container without decoding pixels. */
export const encodedClipboardImageDimensions = (
  bytes: Uint8Array
): EncodedClipboardImageDimensions | null => {
  const mediaType = encodedClipboardImageType(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mediaType === 'image/png' && bytes.byteLength >= 24
    && new TextDecoder('ascii').decode(bytes.subarray(12, 16)) === 'IHDR') {
    return validDimensions(view.getUint32(16), view.getUint32(20));
  }
  if (mediaType === 'image/gif' && bytes.byteLength >= 10) {
    return validDimensions(view.getUint16(6, true), view.getUint16(8, true));
  }
  if (mediaType !== 'image/webp' || bytes.byteLength < 30) return null;
  const chunk = new TextDecoder('ascii').decode(bytes.subarray(12, 16));
  if (chunk === 'VP8X') {
    return validDimensions(
      1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16),
      1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16)
    );
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const packed = view.getUint32(21, true);
    return validDimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return validDimensions(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff
    );
  }
  return null;
};

/** Reads only named encoded-image formats; proprietary clipboard payloads stay untouched. */
export const readPreferredEncodedClipboardImage = (
  source: ClipboardEncodedImageSource
): PreferredClipboardImage | null => {
  const candidates = source.availableFormats()
    .map((format) => ({ format, priority: encodedClipboardImageFormatPriority(format) }))
    .filter((candidate): candidate is { format: string; priority: number } =>
      candidate.priority !== null)
    .sort((left, right) => left.priority - right.priority);

  for (const { format } of candidates) {
    const bytes = source.readBuffer(format);
    if (!bytes.byteLength || bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) continue;
    const mediaType = encodedClipboardImageType(bytes);
    if (mediaType) return { bytes, mediaType, sourceFormat: format };
  }
  return null;
};
