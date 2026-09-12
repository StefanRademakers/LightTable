import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareBrowserClipboardImage } from './browserClipboardImageCodec';

afterEach(() => vi.unstubAllGlobals());

describe('browser clipboard image codec ownership', () => {
  it('keeps exact image dimensions and closes its bitmap once', async () => {
    const bitmap = { width: 20, height: 10, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const prepared = await prepareBrowserClipboardImage(new Blob(['pixels'], { type: 'image/png' }));
    expect(prepared).toMatchObject({ width: 20, height: 10, file: { type: 'image/png' } });
    expect(bitmap.close).not.toHaveBeenCalled();
    prepared.dispose(); prepared.dispose();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes an oversized decoded bitmap before rejecting', async () => {
    const bitmap = { width: 40_000, height: 10, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    await expect(prepareBrowserClipboardImage(new Blob(['pixels']))).rejects.toThrow('resource bounds');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it.each([true, false])('releases SVG canvas on encode success=%s', async success => {
    const bitmap = { width: 20, height: 10, close: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(success ? new Blob(['png'], { type: 'image/png' }) : null) };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    vi.stubGlobal('document', { createElement: () => canvas });
    const result = prepareBrowserClipboardImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    if (success) {
      const prepared = await result;
      expect(prepared.file.type).toBe('image/png');
      prepared.dispose();
    } else await expect(result).rejects.toThrow('could not be encoded');
    expect(canvas).toMatchObject({ width: 1, height: 1 });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
