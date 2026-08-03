import type {
  PdfExportActualTextSpan,
  PdfExportEncodingEntry
} from './exportTextPlan';
import type { PdfMatrix, PdfPaint, PdfPoint, PdfTextRenderingMode } from './types';

export interface PdfNativeTextStroke {
  readonly paint: PdfPaint;
  /** Authored layer-local width; the writer applies the run matrix exactly once. */
  readonly width: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly alpha: number;
}

export interface PdfNativeTextPaint {
  readonly fill: PdfPaint | null;
  readonly fillAlpha: number;
  readonly stroke: PdfNativeTextStroke | null;
}

export interface PdfNativeTextGlyph {
  readonly code: number;
  readonly glyphId: number;
  readonly unicode: string | null;
  readonly origin: PdfPoint;
  readonly advance: PdfPoint;
  /**
   * Text-space to PDF page-space matrix for this glyph before `fontSize` is
   * applied by `Tf`. It already includes hierarchy and Y-axis conversion.
   */
  readonly textMatrix: PdfMatrix;
}

export interface PdfNativeTextRun {
  readonly runId: string;
  readonly layerId: string;
  readonly fontInstanceId: string;
  readonly encodingId: string;
  readonly fontSize: number;
  readonly renderingMode: PdfTextRenderingMode;
  readonly paint: PdfNativeTextPaint;
  readonly encoding: readonly PdfExportEncodingEntry[];
  readonly actualText: readonly PdfExportActualTextSpan[];
  readonly glyphs: readonly PdfNativeTextGlyph[];
}

export interface PdfNativeTextPage {
  readonly widthPoints: number;
  readonly heightPoints: number;
  readonly pixelsPerInch: number;
  readonly runs: readonly PdfNativeTextRun[];
}
