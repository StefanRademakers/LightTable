import { isIdentityAffineMatrix } from '@lighttable/vector-core';
import type { DocumentSession } from '../documents/documentSession';
import type { DocumentPixelRegion } from '../../editor/geometry/documentRegionPreview';
import { planDocumentRegionPreview } from '../../editor/geometry/documentRegionPreview';
import { createDefaultAdjustments } from '../../types';
import type {
  LightTableLayerPreviewRender,
  LightTablePixelClipboardCapture,
  LightTablePreviewEncoding
} from './lightTableCommandContract';

const neutralAdjustments = JSON.stringify(createDefaultAdjustments());

const sourceSnapshot = (session: DocumentSession) => {
  const snapshot = session.getSnapshot();
  const document = snapshot.document;
  const layer = document?.layers.length === 1 ? document.layers[0] : null;
  if (snapshot.lifecycle !== 'ready' || snapshot.dirty || !document
    || !snapshot.loadedSource.blob || layer?.type !== 'raster'
    || !layer.visible || layer.opacity !== 1 || layer.fillOpacity !== 1
    || layer.blendMode !== 'normal' || layer.clipping || layer.mask
    || layer.styleStack.effects.length || layer.adjustmentStack
    || (layer.attachedAdjustments?.length ?? 0) > 0 || layer.derivedPreview
    || layer.photoshop || !isIdentityAffineMatrix(layer.transform)
    || layer.offsetX !== 0 || layer.offsetY !== 0
    || layer.width !== document.width || layer.height !== document.height
    || JSON.stringify(snapshot.processing.adjustments) !== neutralAdjustments) return null;
  return { snapshot, document, layer, blob: snapshot.loadedSource.blob };
};

export const canReadInactiveFlatRaster = (session: DocumentSession): boolean =>
  sourceSnapshot(session) !== null;

const encode = async (blob: Blob, documentWidth: number, documentHeight: number,
  maxEdge: number, encoding: LightTablePreviewEncoding, region?: DocumentPixelRegion) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Inactive raster preview requires bitmap and offscreen-canvas support.');
  }
  const plan = region
    ? planDocumentRegionPreview(documentWidth, documentHeight, region, maxEdge)
    : planDocumentRegionPreview(documentWidth, documentHeight,
      { x: 0, y: 0, width: documentWidth, height: documentHeight }, maxEdge);
  if (!plan) throw new Error('The inactive raster preview region is invalid.');
  const bitmap = await createImageBitmap(blob);
  let canvas: OffscreenCanvas | null = null;
  try {
    canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The inactive raster preview canvas is unavailable.');
    context.drawImage(bitmap, plan.region.x, plan.region.y, plan.region.width, plan.region.height,
      0, 0, plan.outputWidth, plan.outputHeight);
    const mediaType = encoding.format === 'webp' ? 'image/webp' : 'image/png';
    const output = await canvas.convertToBlob({ type: mediaType, quality: encoding.quality });
    return { output, width: plan.outputWidth, height: plan.outputHeight,
      scaleX: plan.outputWidth / plan.region.width,
      scaleY: plan.outputHeight / plan.region.height };
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};

export const exportInactiveFlatRasterPreview = async (session: DocumentSession,
  maxEdge: number, encoding: LightTablePreviewEncoding, region?: DocumentPixelRegion): Promise<File> => {
  const source = sourceSnapshot(session);
  if (!source) throw new Error('Document preview requires an active renderer for edited or layered content.');
  const rendered = await encode(source.blob, source.document.width, source.document.height,
    maxEdge, encoding, region);
  return new File([rendered.output], `inactive-preview.${encoding.format}`, {
    type: rendered.output.type
  });
};

export const exportInactiveFlatRasterLayerPreview = async (session: DocumentSession,
  layerId: string, channel: 'pixels' | 'mask', maxEdge: number,
  encoding: LightTablePreviewEncoding): Promise<LightTableLayerPreviewRender> => {
  const source = sourceSnapshot(session);
  if (!source || source.layer.id !== layerId || channel !== 'pixels') {
    throw new Error('Layer preview requires an active renderer for this layer or channel.');
  }
  const rendered = await encode(source.blob, source.document.width, source.document.height,
    maxEdge, encoding);
  return {
    file: new File([rendered.output], `inactive-layer.${encoding.format}`, {
      type: rendered.output.type
    }),
    width: rendered.width,
    height: rendered.height,
    sourceToOutput: { a: rendered.scaleX, b: 0, c: 0, d: rendered.scaleY, tx: 0, ty: 0 }
  };
};

export const copyInactiveFlatRasterPixels = async (session: DocumentSession):
Promise<LightTablePixelClipboardCapture | null> => {
  const source = sourceSnapshot(session);
  if (!source || source.snapshot.editor.selection.length) return null;
  const rendered = await encode(source.blob, source.document.width, source.document.height,
    Math.max(source.document.width, source.document.height), { format: 'png' });
  return {
    file: new File([rendered.output], 'inactive-raster-copy.png', { type: 'image/png' }),
    bounds: { x: 0, y: 0, width: source.document.width, height: source.document.height }
  };
};
