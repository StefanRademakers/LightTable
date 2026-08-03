import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { writeRasterPdfPage } from './writeRasterPdfPage';

const onePixelPng = () => new Blob([
  Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )).buffer
], { type: 'image/png' });

describe('writeRasterPdfPage', () => {
  it('writes a parseable one-page PDF with physical dimensions derived from ppi', async () => {
    const result = await writeRasterPdfPage({
      png: onePixelPng(),
      widthPixels: 2_457,
      heightPixels: 3_483,
      pixelsPerInch: 300,
      title: 'FormulierPersoneel'
    });

    expect(result.widthPoints).toBeCloseTo(589.68, 5);
    expect(result.heightPoints).toBeCloseTo(835.92, 5);
    expect(result.blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getTitle()).toBe('FormulierPersoneel');
    expect(reopened.getPage(0).getWidth()).toBeCloseTo(589.68, 5);
    expect(reopened.getPage(0).getHeight()).toBeCloseTo(835.92, 5);
  });

  it('rejects unbounded dimensions before loading the writer', async () => {
    await expect(writeRasterPdfPage({
      png: onePixelPng(),
      widthPixels: 32_769,
      heightPixels: 1
    })).rejects.toThrow('no larger than 32768');
  });
});
