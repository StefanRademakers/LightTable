import { describe, expect, it, vi } from 'vitest';
import { readClipboardImageDimensions } from './clipboardImageDimensions';

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const dib = (width: number, height: number) => {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height, true);
  return bytes;
};

describe('clipboard image dimensions', () => {
  it('reads PNG dimensions without constructing or decoding a native image', () => {
    expect(readClipboardImageDimensions({
      availableFormats: () => ['image/png'],
      readBuffer: () => png(6144, 4096)
    })).toEqual({ width: 6144, height: 4096 });
  });

  it('reads top-down Windows DIB dimensions as a positive size', () => {
    expect(readClipboardImageDimensions({
      availableFormats: () => ['CF_DIBV5'],
      readBuffer: () => dib(1920, -1080)
    })).toEqual({ width: 1920, height: 1080 });
  });

  it('skips malformed candidates and tries the next supported format', () => {
    const readBuffer = vi.fn((format: string) => format === 'image/png'
      ? new Uint8Array(8)
      : dib(800, 600));
    expect(readClipboardImageDimensions({
      availableFormats: () => ['text/plain', 'image/png', 'CF_DIB'],
      readBuffer
    })).toEqual({ width: 800, height: 600 });
    expect(readBuffer).toHaveBeenCalledTimes(2);
  });

  it('prefers a compact encoded format over a large Windows DIB', () => {
    const readBuffer = vi.fn((format: string) => {
      if (format === 'CF_DIBV5') throw new Error('large DIB should not be read');
      return png(7680, 4320);
    });
    expect(readClipboardImageDimensions({
      availableFormats: () => ['CF_DIBV5', 'image/png'],
      readBuffer
    })).toEqual({ width: 7680, height: 4320 });
    expect(readBuffer).toHaveBeenCalledTimes(1);
    expect(readBuffer).toHaveBeenCalledWith('image/png');
  });

  it('isolates a broken candidate and de-duplicates equivalent format names', () => {
    const readBuffer = vi.fn((format: string) => {
      if (format.toLowerCase() === 'image/png') throw new Error('delayed provider failed');
      return dib(640, 480);
    });
    expect(readClipboardImageDimensions({
      availableFormats: () => ['image/png', 'IMAGE/PNG', 'CF_DIB'],
      readBuffer
    })).toEqual({ width: 640, height: 480 });
    expect(readBuffer).toHaveBeenCalledTimes(2);
  });

  it('does not read unrelated clipboard payloads', () => {
    const readBuffer = vi.fn(() => new Uint8Array());
    expect(readClipboardImageDimensions({
      availableFormats: () => ['text/plain', 'application/private'],
      readBuffer
    })).toBeNull();
    expect(readBuffer).not.toHaveBeenCalled();
  });
});
