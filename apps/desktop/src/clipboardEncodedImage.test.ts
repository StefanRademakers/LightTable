import { describe, expect, it } from 'vitest';
import {
  encodedClipboardImageType,
  readPreferredEncodedClipboardImage
} from './clipboardEncodedImage';

describe('encoded clipboard images', () => {
  it('recognizes alpha-capable browser image containers by signature', () => {
    expect(encodedClipboardImageType(Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]))).toBe('image/png');
    expect(encodedClipboardImageType(Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
    ]))).toBe('image/webp');
    expect(encodedClipboardImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
  });

  it('prefers a real PNG over a bitmap fallback or lower-priority encoded format', () => {
    const buffers = new Map<string, Uint8Array>([
      ['image/webp', Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
      ])],
      ['image/png', Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ])]
    ]);
    expect(readPreferredEncodedClipboardImage({
      availableFormats: () => ['image/webp', 'image/png', 'image/bmp'],
      readBuffer: (format) => buffers.get(format) ?? new Uint8Array()
    })).toMatchObject({ mediaType: 'image/png', sourceFormat: 'image/png' });
  });

  it('rejects mislabeled encoded data instead of importing arbitrary clipboard bytes', () => {
    expect(readPreferredEncodedClipboardImage({
      availableFormats: () => ['image/png'],
      readBuffer: () => new TextEncoder().encode('not a png')
    })).toBeNull();
  });
});
