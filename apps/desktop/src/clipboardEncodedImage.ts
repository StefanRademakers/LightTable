export interface ClipboardEncodedImageSource {
  availableFormats(): string[];
  readBuffer(format: string): Uint8Array;
}

export interface PreferredClipboardImage {
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';
  readonly sourceFormat: string;
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

const encodedFormatPriority = (format: string) => {
  const normalized = format.toLowerCase();
  if (normalized.includes('png')) return 0;
  if (normalized.includes('webp')) return 1;
  if (normalized.includes('gif')) return 2;
  if (normalized.includes('avif')) return 3;
  return null;
};

/** Reads only named encoded-image formats; proprietary clipboard payloads stay untouched. */
export const readPreferredEncodedClipboardImage = (
  source: ClipboardEncodedImageSource
): PreferredClipboardImage | null => {
  const candidates = source.availableFormats()
    .map((format) => ({ format, priority: encodedFormatPriority(format) }))
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
