import { describe, expect, it } from 'vitest';
import {
  imagePickerAccept,
  imagePickerDescription,
  imagePickerFormatNames,
  isPhotoshopDocument,
  isSupportedImageFile
} from './supportedImageFormats';

describe('LightTable supported image formats', () => {
  it('offers TIFF through the automatic picker while the probe selects its codec', () => {
    expect(isSupportedImageFile(new Blob([], { type: 'image/tiff' }), 'source.tif', 'fast')).toBe(true);
    expect(imagePickerAccept('fast')).toContain('.tif');
  });

  it('advertises PSD on the lazy comparison-import path', () => {
    const psd = new Blob([], { type: 'image/vnd.adobe.photoshop' });
    expect(isSupportedImageFile(psd, 'comparison.psd', 'fast')).toBe(true);
    expect(isPhotoshopDocument(psd, 'comparison.psd')).toBe(true);
    expect(isPhotoshopDocument(new Blob(), 'comparison.PSD')).toBe(true);
    expect(imagePickerAccept('fast')).toContain('.psd');
    expect(imagePickerAccept('fast')).toContain('.psb');
    expect(imagePickerFormatNames('fast')).toContain('PSD');
  });

  it('advertises every currently supported precision-preserving format', () => {
    const accept = imagePickerAccept('preserve-precision');
    expect(accept).toContain('image/png');
    expect(accept).toContain('.tif');
    expect(accept).toContain('.tiff');
    expect(accept).toContain('.jpg');
    expect(accept).toContain('.webp');
    expect(imagePickerDescription('preserve-precision')).toContain('PNG, TIFF, JPEG, WebP');
    expect(imagePickerFormatNames('preserve-precision')).toBe('PNG, TIFF, JPEG, WebP');
  });

  it('uses extensions only when the browser does not provide a useful MIME type', () => {
    expect(isSupportedImageFile(new Blob(), 'scan.TIFF', 'preserve-precision')).toBe(true);
    expect(isSupportedImageFile(new Blob([], { type: 'application/octet-stream' }), 'scan.tif', 'preserve-precision')).toBe(true);
    expect(isSupportedImageFile(new Blob([], { type: 'text/plain' }), 'renamed.png', 'preserve-precision')).toBe(false);
  });
});
