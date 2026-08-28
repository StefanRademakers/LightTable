import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const PDF_RASTER_TARGET_PIXELS_PER_POINT = 300 / 72;
export const PDF_RASTER_MAXIMUM_PIXELS = 64 * 1024 * 1024;
export const PDF_RASTER_MAXIMUM_EDGE = 16_384;

export interface PdfRasterSizePlan {
  readonly scalePixelsPerPoint: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfRasterPreview {
  readonly preview: Blob;
  readonly pageCount: number;
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly scalePixelsPerPoint: number;
}

const positiveFinite = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and greater than zero.`);
  }
};

const rasterEdge = (value: number) => {
  const nearestInteger = Math.round(value);
  return Math.max(1, Math.abs(value - nearestInteger) <= 1e-7
    ? nearestInteger
    : Math.ceil(value));
};

/**
 * Chooses one bounded page raster while retaining 300 ppi whenever possible.
 * Semantic PDF import will use the tiled page contract instead of this preview.
 */
export const planPdfRasterSize = (
  widthPoints: number,
  heightPoints: number,
  targetScale = PDF_RASTER_TARGET_PIXELS_PER_POINT,
  maximumPixels = PDF_RASTER_MAXIMUM_PIXELS,
  maximumEdge = PDF_RASTER_MAXIMUM_EDGE
): PdfRasterSizePlan => {
  positiveFinite(widthPoints, 'PDF page width');
  positiveFinite(heightPoints, 'PDF page height');
  positiveFinite(targetScale, 'PDF raster scale');
  positiveFinite(maximumPixels, 'PDF raster pixel budget');
  positiveFinite(maximumEdge, 'PDF raster maximum edge');

  const pixelBudgetScale = Math.sqrt(maximumPixels / (widthPoints * heightPoints));
  const edgeScale = Math.min(maximumEdge / widthPoints, maximumEdge / heightPoints);
  const scalePixelsPerPoint = Math.min(targetScale, pixelBudgetScale, edgeScale);
  // PDF point dimensions often originate from an exact pixel count divided by
  // the target PPI. Avoid adding a phantom edge pixel when the inverse product
  // lands infinitesimally above that integer through floating-point arithmetic.
  const width = rasterEdge(widthPoints * scalePixelsPerPoint);
  const height = rasterEdge(heightPoints * scalePixelsPerPoint);
  return { scalePixelsPerPoint, width, height };
};

const canvasToPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('The PDF page preview could not be encoded as PNG.'));
  }, 'image/png');
});

/** Lazy browser/Electron PDF page rasterizer; never used as semantic importer. */
export const decodePdfRasterPreview = async (
  blob: Blob,
  signal?: AbortSignal
): Promise<PdfRasterPreview> => {
  if (signal?.aborted) throw new DOMException('The PDF import was cancelled.', 'AbortError');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (signal?.aborted) throw new DOMException('The PDF import was cancelled.', 'AbortError');

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false
  });
  const abortLoading = () => { void loadingTask.destroy(); };
  signal?.addEventListener('abort', abortLoading, { once: true });
  try {
    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'PasswordException') {
        throw new Error(
          'This password-protected PDF cannot be opened because password entry is not supported yet.'
        );
      }
      throw reason;
    }
    if (pdf.numPages < 1) throw new Error('The PDF contains no pages.');
    const page = await pdf.getPage(1);
    const unitViewport = page.getViewport({ scale: 1 });
    const plan = planPdfRasterSize(unitViewport.width, unitViewport.height);
    const viewport = page.getViewport({ scale: plan.scalePixelsPerPoint });
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('A 2D canvas is required to preview PDF pages.');
    const renderTask = page.render({ canvas, canvasContext: context, viewport });
    const abortRender = () => renderTask.cancel();
    signal?.addEventListener('abort', abortRender, { once: true });
    try {
      await renderTask.promise;
      if (signal?.aborted) throw new DOMException('The PDF import was cancelled.', 'AbortError');
      return {
        preview: await canvasToPng(canvas),
        pageCount: pdf.numPages,
        pageNumber: 1,
        width: plan.width,
        height: plan.height,
        scalePixelsPerPoint: plan.scalePixelsPerPoint
      };
    } finally {
      signal?.removeEventListener('abort', abortRender);
      page.cleanup();
      // PNG encoding has finished (or failed), so release the potentially
      // 64-Mpixel browser backing store immediately instead of retaining it
      // until the detached element is eventually collected.
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    signal?.removeEventListener('abort', abortLoading);
    await loadingTask.destroy();
  }
};
