import { describe, expect, it } from 'vitest';
import { pdfExportSupportForDisposition } from './PdfExportPreflightDialog';

describe('PDF export preflight presentation', () => {
  it('maps export decisions onto the established compatibility report states', () => {
    expect(pdfExportSupportForDisposition('subset')).toBe('native');
    expect(pdfExportSupportForDisposition('embed-existing')).toBe('native');
    expect(pdfExportSupportForDisposition('mixed')).toBe('approximate');
    expect(pdfExportSupportForDisposition('outline')).toBe('approximate');
    expect(pdfExportSupportForDisposition('raster')).toBe('raster-preview');
    expect(pdfExportSupportForDisposition('blocked')).toBe('placeholder');
  });
});
