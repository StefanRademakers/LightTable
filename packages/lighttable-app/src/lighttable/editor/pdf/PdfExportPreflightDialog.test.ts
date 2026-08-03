import { describe, expect, it } from 'vitest';
import {
  formatPdfFontBytes,
  pdfExportSupportForDisposition
} from './PdfExportPreflightDialog';

describe('PDF export preflight presentation', () => {
  it('maps export decisions onto the established compatibility report states', () => {
    expect(pdfExportSupportForDisposition('subset')).toBe('native');
    expect(pdfExportSupportForDisposition('embed-existing')).toBe('native');
    expect(pdfExportSupportForDisposition('mixed')).toBe('approximate');
    expect(pdfExportSupportForDisposition('outline')).toBe('approximate');
    expect(pdfExportSupportForDisposition('raster')).toBe('raster-preview');
    expect(pdfExportSupportForDisposition('blocked')).toBe('placeholder');
  });

  it('formats validation output with the existing compact byte convention', () => {
    expect(formatPdfFontBytes(512)).toBe('512 B');
    expect(formatPdfFontBytes(1536)).toBe('1.5 KiB');
    expect(formatPdfFontBytes(25 * 1024)).toBe('25 KiB');
  });
});
