import type { NativeBitmapFormatId } from '@lighttable/app/bitmap-formats';

const ascii = (bytes: Uint8Array, offset: number, value: string) =>
  value.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0));

export const nativeBitmapContainerFormat = (bytes: Uint8Array): NativeBitmapFormatId | null => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  if (bytes.length >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  )) return 'tiff';
  return null;
};
export const assertNativeBitmapContainer = (
  bytes: Uint8Array,
  expected: NativeBitmapFormatId
): void => {
  const actual = nativeBitmapContainerFormat(bytes);
  if (actual !== expected) {
    throw new Error(`Prepared ${expected.toUpperCase()} replacement contains ${actual?.toUpperCase() ?? 'unknown'} bytes.`);
  }
};
