import { describe, expect, it } from 'vitest';
import { assertNativeBitmapContainer, nativeBitmapContainerFormat } from './nativeBitmapContainer';

describe('native bitmap container validation', () => {
  it.each([
    ['png', Uint8Array.from([0x89, 80, 78, 71, 13, 10, 26, 10])],
    ['jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    ['webp', Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])],
    ['tiff', Uint8Array.from([0x49, 0x49, 0x2a, 0x00])],
    ['tiff', Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a])]
  ] as const)('detects %s signatures', (format, bytes) => {
    expect(nativeBitmapContainerFormat(bytes)).toBe(format);
  });

  it('rejects extension/payload mismatches before source replacement', () => {
    expect(() => assertNativeBitmapContainer(
      Uint8Array.from([0x89, 80, 78, 71, 13, 10, 26, 10]), 'webp'
    )).toThrow(/contains PNG bytes/);
  });
});
