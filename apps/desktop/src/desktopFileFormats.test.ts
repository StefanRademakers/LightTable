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
  });

  it('preserves the PDF media type across the desktop bridge', () => {
    expect(desktopMediaTypeForFileName('FormulierPersoneel.PDF')).toBe('application/pdf');
    expect(desktopMediaTypeForFileName('unknown.bin')).toBe('');
  });
});
