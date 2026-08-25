import { describe, expect, it } from 'vitest';
import {
  createDesktopOpenDialogFilters,
  desktopMediaTypeForFileName
} from './desktopFileFormats';

describe('desktop file formats', () => {
  it('offers PDF explicitly and in the combined document filter', () => {
    const filters = createDesktopOpenDialogFilters();
    expect(filters[0]?.extensions).toContain('pdf');
    expect(filters).toContainEqual({ name: 'PDF documents', extensions: ['pdf'] });
    expect(filters).toContainEqual({ name: 'SVG documents', extensions: ['svg'] });
    expect(filters[0]?.extensions).toEqual(expect.arrayContaining(['mp4', 'webm']));
    expect(filters).toContainEqual({ name: 'Video files', extensions: ['mp4', 'webm'] });
  });

  it('preserves the PDF media type across the desktop bridge', () => {
    expect(desktopMediaTypeForFileName('FormulierPersoneel.PDF')).toBe('application/pdf');
    expect(desktopMediaTypeForFileName('logo.SVG')).toBe('image/svg+xml');
    expect(desktopMediaTypeForFileName('generated-video.MP4')).toBe('video/mp4');
    expect(desktopMediaTypeForFileName('generated-video.webm')).toBe('video/webm');
    expect(desktopMediaTypeForFileName('unknown.bin')).toBe('');
  });
});
