const DEFAULT_PIXELS_PER_INCH = 300;
const MAXIMUM_SOURCE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_PIXEL_EDGE = 32_768;
const MAXIMUM_PAGE_POINTS = 14_400;

export interface RasterPdfPageInput {
  readonly png: Blob;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly pixelsPerInch?: number;
  readonly title?: string;
}

export interface RasterPdfPageResult {
  readonly blob: Blob;
  readonly widthPoints: number;
  readonly heightPoints: number;
}

const positiveFinite = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and greater than zero.`);
  }
};

const boundedInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAXIMUM_PIXEL_EDGE) {
    throw new Error(`${label} must be a positive integer no larger than ${MAXIMUM_PIXEL_EDGE}.`);
  }
};

/**
 * Writes one bounded, flattened PDF page from the current GPU-rendered PNG.
 * pdf-lib remains behind this explicit export boundary and is loaded lazily.
 */
export const writeRasterPdfPage = async ({
  png,
  widthPixels,
  heightPixels,
  pixelsPerInch = DEFAULT_PIXELS_PER_INCH,
  title
}: RasterPdfPageInput): Promise<RasterPdfPageResult> => {
  boundedInteger(widthPixels, 'PDF source width');
  boundedInteger(heightPixels, 'PDF source height');
  positiveFinite(pixelsPerInch, 'PDF source resolution');
  if (pixelsPerInch > 2_400) throw new Error('PDF source resolution exceeds 2400 ppi.');
  if (png.size <= 0 || png.size > MAXIMUM_SOURCE_BYTES) {
    throw new Error(`PDF source PNG must contain at most ${MAXIMUM_SOURCE_BYTES} bytes.`);
  }
  if (png.type && png.type !== 'image/png') {
    throw new Error('PDF page export requires a PNG source.');
  }

  const widthPoints = widthPixels * 72 / pixelsPerInch;
  const heightPoints = heightPixels * 72 / pixelsPerInch;
  if (widthPoints > MAXIMUM_PAGE_POINTS || heightPoints > MAXIMUM_PAGE_POINTS) {
    throw new Error(`PDF page dimensions exceed ${MAXIMUM_PAGE_POINTS} points.`);
  }

  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setProducer('LightTable');
  document.setCreator('LightTable');
  if (title) document.setTitle(title);
  const image = await document.embedPng(await png.arrayBuffer());
  const page = document.addPage([widthPoints, heightPoints]);
  page.drawImage(image, { x: 0, y: 0, width: widthPoints, height: heightPoints });
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: true });
  return {
    blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
    widthPoints,
    heightPoints
  };
};
