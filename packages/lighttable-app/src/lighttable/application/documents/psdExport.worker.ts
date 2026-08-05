/// <reference lib="webworker" />

import agPsd from 'ag-psd';
import type { PixelData } from 'ag-psd';
import { projectDocumentToPsd } from './psdExportProjection';
import type { PsdExportRequest, PsdExportResponse } from './psdExportProtocol';

const { initializeCanvas, writePsdUint8Array } = agPsd;
initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => new ImageData(width, height)
);

const decode = async (blob: Blob): Promise<PixelData | undefined> => {
  if (blob.size === 0) return undefined;
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none', colorSpaceConversion: 'none'
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('PSD export could not create a pixel decode surface.');
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: image.data, width: image.width, height: image.height };
  } finally {
    bitmap.close();
  }
};

self.onmessage = async (event: MessageEvent<PsdExportRequest>) => {
  const request = event.data;
  try {
    const composite = await decode(request.composite);
    if (!composite) throw new Error('PSD export requires a rendered composite.');
    const assets = await Promise.all(request.layerAssets.map(async (asset) => ({
      layerId: asset.layerId,
      bounds: asset.bounds,
      pixels: await decode(asset.pixels),
      mask: asset.mask ? await decode(asset.mask) : undefined
    })));
    const projection = projectDocumentToPsd(request.document, composite, assets);
    const psb = request.document.width > 30_000 || request.document.height > 30_000;
    const bytes = writePsdUint8Array(projection.psd, {
      psb,
      // Electron's module-worker ImageData brand is not accepted by the
      // OffscreenCanvas context used inside ag-psd's optional thumbnail path.
      // The full composite is authoritative and Photoshop regenerates this
      // cache on open/save, so omit it instead of copying document pixels.
      generateThumbnail: false,
      trimImageData: true,
      noBackground: true,
      compress: false,
      invalidateTextLayers: false,
      logMissingFeatures: false
    });
    self.postMessage({
      requestId: request.requestId,
      status: 'success',
      bytes,
      warnings: projection.warnings,
      editableTextLayers: projection.editableTextLayers,
      editableVectorLayers: projection.editableVectorLayers
    } satisfies PsdExportResponse, { transfer: [bytes.buffer] });
  } catch (reason) {
    self.postMessage({
      requestId: request.requestId,
      status: 'error',
      message: reason instanceof Error ? reason.message : String(reason)
    } satisfies PsdExportResponse);
  }
};
