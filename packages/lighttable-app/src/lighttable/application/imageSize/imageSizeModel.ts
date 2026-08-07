import type { ImageDocument, LayerNode } from '../../editor/document/documentTypes';
import { multiplyMatrices, scaleMatrix } from '../../editor/geometry/affine';

export type ImageSizeUnit = 'pixels' | 'percent' | 'inches' | 'centimeters' | 'millimeters' | 'points' | 'picas';
export type ResolutionUnit = 'pixels-per-inch' | 'pixels-per-centimeter';
export type ResampleMethod =
  | 'automatic' | 'preserve-details' | 'preserve-details-2'
  | 'bicubic-smoother' | 'bicubic-sharper' | 'bicubic'
  | 'nearest' | 'bilinear';
export type ConcreteResampleMethod = Exclude<ResampleMethod, 'automatic'>;

export interface OriginalImageSizeState {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly resolutionPpi: number;
  readonly aspectRatio: number;
}

export interface ImageSizeRequest {
  readonly width: number;
  readonly height: number;
  readonly resolutionPpi: number;
  readonly resample: boolean;
  readonly method: ResampleMethod;
  readonly preserveDetailsNoiseReduction: number;
  readonly scaleStyles: boolean;
}

export interface ResizePlan {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly requestedMethod: ResampleMethod;
  readonly resolvedMethod: ConcreteResampleMethod | null;
  readonly passes: readonly { readonly width: number; readonly height: number }[];
}

export const MAX_IMAGE_SIZE_DIMENSION = 16_384;

const RESAMPLE_METHODS = new Set<ResampleMethod>([
  'automatic', 'preserve-details', 'preserve-details-2', 'bicubic-smoother',
  'bicubic-sharper', 'bicubic', 'nearest', 'bilinear'
]);

export const parseImageSizeRequest = (value: unknown): ImageSizeRequest | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Image Size parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
    || Number(input.width) < 1 || Number(input.height) < 1
    || Number(input.width) > MAX_IMAGE_SIZE_DIMENSION || Number(input.height) > MAX_IMAGE_SIZE_DIMENSION) {
    return { message: `Image dimensions must be integers from 1 to ${MAX_IMAGE_SIZE_DIMENSION} pixels.` };
  }
  if (typeof input.resolutionPpi !== 'number' || !Number.isFinite(input.resolutionPpi)
    || input.resolutionPpi < 1 || input.resolutionPpi > 2400) {
    return { message: 'Resolution must be between 1 and 2400 pixels per inch.' };
  }
  if (typeof input.resample !== 'boolean' || typeof input.scaleStyles !== 'boolean'
    || typeof input.method !== 'string' || !RESAMPLE_METHODS.has(input.method as ResampleMethod)
    || typeof input.preserveDetailsNoiseReduction !== 'number'
    || !Number.isFinite(input.preserveDetailsNoiseReduction)
    || input.preserveDetailsNoiseReduction < 0 || input.preserveDetailsNoiseReduction > 100) {
    return { message: 'Resample, method, Reduce Noise and Scale Styles parameters are invalid.' };
  }
  return {
    width: Number(input.width), height: Number(input.height), resolutionPpi: input.resolutionPpi,
    resample: input.resample, method: input.method as ResampleMethod,
    preserveDetailsNoiseReduction: input.preserveDetailsNoiseReduction, scaleStyles: input.scaleStyles
  };
};

export const captureOriginalImageSize = (document: ImageDocument): OriginalImageSizeState => ({
  widthPx: document.width,
  heightPx: document.height,
  resolutionPpi: document.resolutionPpi,
  aspectRatio: document.width / document.height
});

export const resolutionToPpi = (value: number, unit: ResolutionUnit) =>
  unit === 'pixels-per-centimeter' ? value * 2.54 : value;

export const resolutionFromPpi = (ppi: number, unit: ResolutionUnit) =>
  unit === 'pixels-per-centimeter' ? ppi / 2.54 : ppi;

export const pixelsToSizeUnit = (
  pixels: number,
  unit: ImageSizeUnit,
  resolutionPpi: number,
  originalPixels: number
): number => {
  switch (unit) {
    case 'pixels': return pixels;
    case 'percent': return pixels / originalPixels * 100;
    case 'inches': return pixels / resolutionPpi;
    case 'centimeters': return pixels / resolutionPpi * 2.54;
    case 'millimeters': return pixels / resolutionPpi * 25.4;
    case 'points': return pixels / resolutionPpi * 72;
    case 'picas': return pixels / resolutionPpi * 6;
  }
};

export const sizeUnitToPixels = (
  value: number,
  unit: ImageSizeUnit,
  resolutionPpi: number,
  originalPixels: number
): number => {
  switch (unit) {
    case 'pixels': return value;
    case 'percent': return originalPixels * value / 100;
    case 'inches': return value * resolutionPpi;
    case 'centimeters': return value / 2.54 * resolutionPpi;
    case 'millimeters': return value / 25.4 * resolutionPpi;
    case 'points': return value / 72 * resolutionPpi;
    case 'picas': return value / 6 * resolutionPpi;
  }
};

export const resolveAutomaticResampleMethod = (
  source: { readonly width: number; readonly height: number },
  target: { readonly width: number; readonly height: number }
): ConcreteResampleMethod | null => {
  const x = target.width / source.width;
  const y = target.height / source.height;
  if (x === 1 && y === 1) return null;
  if (x >= 1 && y >= 1) return 'bicubic-smoother';
  if (x <= 1 && y <= 1) return 'bicubic-sharper';
  return 'bicubic';
};

export const createResizePlan = (
  source: { readonly width: number; readonly height: number },
  request: ImageSizeRequest
): ResizePlan => {
  const targetWidth = request.resample ? Math.round(request.width) : source.width;
  const targetHeight = request.resample ? Math.round(request.height) : source.height;
  if (
    !Number.isInteger(targetWidth) || !Number.isInteger(targetHeight)
    || targetWidth < 1 || targetHeight < 1
    || targetWidth > MAX_IMAGE_SIZE_DIMENSION || targetHeight > MAX_IMAGE_SIZE_DIMENSION
  ) throw new Error(`Image dimensions must be between 1 and ${MAX_IMAGE_SIZE_DIMENSION} pixels.`);
  if (!Number.isFinite(request.resolutionPpi) || request.resolutionPpi < 1 || request.resolutionPpi > 2400) {
    throw new Error('Resolution must be between 1 and 2400 pixels per inch.');
  }
  const resolvedMethod = !request.resample || (targetWidth === source.width && targetHeight === source.height)
    ? null
    : request.method === 'automatic'
      ? resolveAutomaticResampleMethod(source, { width: targetWidth, height: targetHeight })
      : request.method;
  const passes: Array<{ width: number; height: number }> = [];
  let width = source.width;
  let height = source.height;
  while (targetWidth / width < 0.5 || targetHeight / height < 0.5) {
    width = Math.max(targetWidth, Math.ceil(width / 2));
    height = Math.max(targetHeight, Math.ceil(height / 2));
    passes.push({ width, height });
  }
  if (resolvedMethod && (width !== targetWidth || height !== targetHeight)) {
    passes.push({ width: targetWidth, height: targetHeight });
  }
  return {
    sourceWidth: source.width, sourceHeight: source.height,
    targetWidth, targetHeight,
    scaleX: targetWidth / source.width, scaleY: targetHeight / source.height,
    requestedMethod: request.method, resolvedMethod, passes
  };
};

export const estimateDocumentImageBytes = (
  width: number,
  height: number,
  bitDepth: ImageDocument['colorSettings']['bitDepth'],
  channelCount = 4
) => width * height * channelCount * (bitDepth === 8 ? 1 : bitDepth === 16 ? 2 : 4);

const scaleNode = (
  node: LayerNode,
  scaleX: number,
  scaleY: number,
  effectScale: number | null,
  root: boolean
): LayerNode => {
  const documentTransform = root
    ? multiplyMatrices(scaleMatrix(scaleX, scaleY), node.transform)
    : node.transform;
  // Raster pixels are physically resampled to the new local dimensions. The
  // inverse local scale prevents that larger texture and the document-space
  // root scale from being applied twice.
  const transform = node.type === 'raster'
    ? multiplyMatrices(documentTransform, scaleMatrix(1 / scaleX, 1 / scaleY))
    : documentTransform;
  const common = {
    transform,
    styleStack: effectScale === null ? node.styleStack : {
      ...node.styleStack,
      scale: node.styleStack.scale * effectScale,
      revision: node.styleStack.revision + 1
    },
    geometryRevision: node.geometryRevision + 1,
    revision: node.revision + 1,
    modifiedAt: Date.now()
  };
  if (node.type === 'raster') return {
    ...node,
    ...common,
    width: Math.max(1, Math.round(node.width * scaleX)),
    height: Math.max(1, Math.round(node.height * scaleY)),
    offsetX: node.offsetX * scaleX,
    offsetY: node.offsetY * scaleY,
    pixelRevision: node.pixelRevision + 1,
    dirtyBounds: null
  };
  if (node.type === 'group') return {
    ...node,
    ...common,
    children: node.children.map((child) => scaleNode(child, scaleX, scaleY, effectScale, false))
  };
  return { ...node, ...common };
};

/**
 * Applies document-level resize semantics without flattening the layer tree.
 * Root transforms carry the document-space scale, so nested paths, text and
 * live shapes retain their exact editable local representation.
 */
export const resizeImageDocumentSemantics = (
  document: ImageDocument,
  request: ImageSizeRequest
): ImageDocument => {
  const plan = createResizePlan(document, request);
  const pixelDimensionsChanged = plan.targetWidth !== document.width || plan.targetHeight !== document.height;
  const resolutionChanged = request.resolutionPpi !== document.resolutionPpi;
  if (!pixelDimensionsChanged && !resolutionChanged) return document;
  const effectScale = request.scaleStyles && pixelDimensionsChanged
    ? Math.sqrt(plan.scaleX * plan.scaleY)
    : null;
  return {
    ...document,
    width: plan.targetWidth,
    height: plan.targetHeight,
    resolutionPpi: request.resolutionPpi,
    layers: pixelDimensionsChanged
      ? document.layers.map((node) => scaleNode(node, plan.scaleX, plan.scaleY, effectScale, true))
      : document.layers,
    revision: document.revision + 1,
    modifiedAt: Date.now()
  };
};
