import { describe, expect, it } from 'vitest';
import {
  PDF_RASTER_TARGET_PIXELS_PER_POINT,
  planPdfRasterSize
} from './PdfRasterDecoder';

describe('PDF raster preview planning', () => {
  it('renders the FormulierPersoneel page at effectively native scan resolution', () => {
    const plan = planPdfRasterSize(589.68, 835.92);
    expect(plan.scalePixelsPerPoint).toBe(PDF_RASTER_TARGET_PIXELS_PER_POINT);
    expect(plan).toMatchObject({ width: 2457, height: 3483 });
  });

  it('bounds pathological pages by both pixel count and canvas edge', () => {
    const plan = planPdfRasterSize(20_000, 20_000);
    expect(plan.width).toBeLessThanOrEqual(16_384);
    expect(plan.height).toBeLessThanOrEqual(16_384);
    expect(plan.width * plan.height).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it('does not add a phantom pixel when reopening an exact 300-ppi export', () => {
    const plan = planPdfRasterSize(1001 * 72 / 300, 598 * 72 / 300);
    expect(plan).toMatchObject({ width: 1001, height: 598 });
  });

  it('rejects invalid page geometry before allocating a canvas', () => {
    expect(() => planPdfRasterSize(0, 100)).toThrow('page width');
    expect(() => planPdfRasterSize(100, Number.NaN)).toThrow('page height');
  });
});
