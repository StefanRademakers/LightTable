import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import type { PdfFontMaterializationDependencies, PdfFontMaterializationResult } from './materializePdfFonts';
import type { NativeTextPdfPageInput } from '../../infrastructure/pdf/writeNativeTextPdfPage';
import type { PdfDisplayListPageInput } from '../../infrastructure/pdf/writePdfDisplayListPage';
import type { RasterPdfPageInput } from '../../infrastructure/pdf/writeRasterPdfPage';

/** Lazy codec operations only; document and export-request lifetime stay outside codecs. */
export interface PdfExportServices {
  materializeFonts(plan: PdfTextExportPlan,
    source: Pick<PdfFontMaterializationDependencies, 'fonts' | 'loadFontBytes'>): Promise<PdfFontMaterializationResult>;
  writeText(input: NativeTextPdfPageInput): Promise<{ blob: Blob }>;
  writeVector(input: PdfDisplayListPageInput): Promise<{ blob: Blob }>;
  writeRaster(input: RasterPdfPageInput): Promise<{ blob: Blob }>;
}
