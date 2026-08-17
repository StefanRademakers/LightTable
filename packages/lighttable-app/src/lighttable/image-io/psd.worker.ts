/// <reference lib="webworker" />

import agPsd from 'ag-psd';
import type { Layer, PatternInfo, Psd } from 'ag-psd';
import { psdCompositeToPreviewPixels } from './psdPixelConversion';
import { recoverPsdGlobalTextPaths } from './psdGlobalTextPaths';
import type {
  PsdFeatureInventory,
  PsdDecodeStage,
  PsdLayerNodeDto,
  PsdPatternDto,
  PsdWorkerRequest,
  PsdWorkerResponse
} from './psdProtocol';
import {
  PSD_RAW_ADOBE_RGBA16_MEDIA_TYPE,
  PSD_RAW_ADOBE_RGBA8_MEDIA_TYPE,
  PSD_RAW_RGBA16_MEDIA_TYPE,
  PSD_RAW_RGBA8_MEDIA_TYPE
} from './psdProtocol';
import { readPsdColorProfile } from './psdColorProfile';
import {
  applyPsdVibranceDescriptorExtensions,
  readPsdVibranceDescriptorExtensions
} from './psdVibranceDescriptor';
import {
  createPsdPixelNormalizer,
  type PsdPixelNormalizer
} from './psdColorManagement.worker';

const publishProgress = (requestId: number, stage: PsdDecodeStage) => {
  self.postMessage({ kind: 'progress', requestId, stage } satisfies PsdWorkerResponse);
};

const MAX_DIMENSION = 30_000;
const MAX_PIXELS = 400_000_000;
const MAX_LAYERS = 10_000;
const MAX_DEPTH = 128;
const MAX_DECODED_BYTES = 1024 * 1024 * 1024;
const COLOR_MODE_NAMES: Record<number, string> = {
  0: 'Bitmap',
  1: 'Grayscale',
  2: 'Indexed',
  3: 'RGB',
  4: 'CMYK',
  7: 'Multichannel',
  8: 'Duotone',
  9: 'Lab'
};

let agPsdCanvasInitialized = false;
const { initializeCanvas, readPsd } = agPsd;

const initializeAgPsdCanvas = () => {
  if (agPsdCanvasInitialized) return;
  // ag-psd normally discovers document.createElement('canvas') at module load.
  // A module worker has no document, so Photoshop resources that internally
  // request a canvas (even while image pixels use ImageData) otherwise throw
  // "Canvas not initialized". Keep that dependency on the worker boundary.
  //
  // This runtime import deliberately stays static. The PSD worker itself is
  // created lazily, so ordinary image startup does not download ag-psd. A
  // nested dynamic import inside a Vite module worker produced an invalid
  // interop chunk in Electron ("Export is not defined").
  initializeCanvas(
    (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
    (width, height) => new ImageData(width, height)
  );
  agPsdCanvasInitialized = true;
};

const emptyInventory = (): PsdFeatureInventory => ({
  layers: 0,
  groups: 0,
  rasterPreviews: 0,
  masks: 0,
  layerStyles: 0,
  adjustments: 0,
  textLayers: 0,
  smartObjects: 0,
  vectorLayers: 0,
  maximumDepth: 0
});

const inspectLayers = (
  layers: readonly Layer[] | undefined,
  inventory: PsdFeatureInventory,
  depth = 1
) => {
  if (!layers) return;
  inventory.maximumDepth = Math.max(inventory.maximumDepth, depth);
  if (depth > MAX_DEPTH) throw new Error(`PSD nesting exceeds the ${MAX_DEPTH}-level safety limit.`);
  for (const layer of layers) {
    inventory.layers += 1;
    if (inventory.layers > MAX_LAYERS) {
      throw new Error(`PSD contains more than the ${MAX_LAYERS}-layer safety limit.`);
    }
    if (layer.children) inventory.groups += 1;
    if (layer.imageData) inventory.rasterPreviews += 1;
    if (layer.mask?.imageData || layer.realMask?.imageData || layer.vectorMask) inventory.masks += 1;
    if (layer.effects) inventory.layerStyles += 1;
    if (layer.adjustment) inventory.adjustments += 1;
    if (layer.text) inventory.textLayers += 1;
    if (layer.placedLayer) inventory.smartObjects += 1;
    if (layer.vectorFill || layer.vectorMask || layer.vectorStroke) inventory.vectorLayers += 1;
    inspectLayers(layer.children, inventory, depth + 1);
  }
};

const validateDocument = (psd: Psd) => {
  if (
    !Number.isInteger(psd.width)
    || !Number.isInteger(psd.height)
    || psd.width <= 0
    || psd.height <= 0
    || psd.width > MAX_DIMENSION
    || psd.height > MAX_DIMENSION
    || psd.width * psd.height > MAX_PIXELS
  ) {
    throw new Error(
      `PSD dimensions ${psd.width} x ${psd.height} exceed LightTable's comparison-import safety limits.`
    );
  }
  if (!psd.imageData) {
    throw new Error('The PSD has no embedded Photoshop composite image.');
  }
  if (
    psd.imageData.width !== psd.width
    || psd.imageData.height !== psd.height
    || psd.imageData.data.length !== psd.width * psd.height * 4
  ) {
    throw new Error('The PSD embedded composite dimensions are inconsistent.');
  }
};

const createPreview = async (psd: Psd, normalizer: PsdPixelNormalizer) => {
  const pixels = await normalizer.transform(
    psdCompositeToPreviewPixels(psd.imageData!.data, psd.bitsPerChannel ?? 8),
    psd.width,
    psd.height
  );
  const canvas = new OffscreenCanvas(psd.width, psd.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The PSD worker could not create its preview canvas.');
  context.putImageData(new ImageData(copyClampedPixels(pixels), psd.width, psd.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
};

const copyClampedPixels = (source: ArrayBufferView) => {
  const copy = new Uint8ClampedArray(source.byteLength);
  copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return copy;
};

const imageDataBlob = async (
  data: NonNullable<Layer['imageData']>,
  bitsPerChannel: number,
  canvasWidth: number,
  canvasHeight: number,
  left: number,
  top: number,
  mask = false,
  defaultColor = 0
) => {
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The PSD worker could not create a layer canvas.');
  context.fillStyle = mask
    ? defaultColor >= 128 ? '#ffffff' : '#000000'
    : 'rgba(0,0,0,0)';
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  const pixels = psdCompositeToPreviewPixels(data.data, bitsPerChannel);
  if (mask) {
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index];
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  context.putImageData(new ImageData(pixels, data.width, data.height), left, top);
  return canvas.convertToBlob({ type: 'image/png' });
};

const layerImageDataBlob = async (
  data: NonNullable<Layer['imageData']>,
  bitsPerChannel: number,
  normalizer: PsdPixelNormalizer
) => {
  if (bitsPerChannel === 16 && data.data instanceof Uint16Array) {
    const pixels = normalizer.sourceProfile === 'adobe-rgb-1998'
      ? new Uint16Array(data.data)
      : await normalizer.transform(new Uint16Array(data.data), data.width, data.height, 16);
    if (!(pixels instanceof Uint16Array)) {
      throw new Error('The PSD color transform returned the wrong 16-bit pixel representation.');
    }
    const bytes = new Uint8Array(pixels.byteLength);
    bytes.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
    return new Blob([bytes.buffer], {
      type: normalizer.sourceProfile === 'adobe-rgb-1998'
        ? PSD_RAW_ADOBE_RGBA16_MEDIA_TYPE
        : PSD_RAW_RGBA16_MEDIA_TYPE
    });
  }
  const source = psdCompositeToPreviewPixels(data.data, bitsPerChannel);
  const pixels = normalizer.sourceProfile === 'adobe-rgb-1998'
    ? source
    : await normalizer.transform(source, data.width, data.height, 8);
  if (!(pixels instanceof Uint8ClampedArray)) {
    throw new Error('The PSD color transform returned the wrong 8-bit pixel representation.');
  }
  return new Blob([copyClampedPixels(pixels)], {
    type: normalizer.sourceProfile === 'adobe-rgb-1998'
      ? PSD_RAW_ADOBE_RGBA8_MEDIA_TYPE
      : PSD_RAW_RGBA8_MEDIA_TYPE
  });
};

const transparentDocumentBlob = async (width: number, height: number) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The PSD worker could not create a transparent semantic-layer fallback.');
  context.clearRect(0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
};

const patternBlob = async (pattern: PatternInfo, normalizer: PsdPixelNormalizer) => {
  const { w: width, h: height } = pattern.bounds;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || pattern.data.length !== width * height * 4
  ) {
    throw new Error(`PSD pattern "${pattern.name}" has invalid RGBA dimensions.`);
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The PSD worker could not create a pattern canvas.');
  context.putImageData(
    new ImageData(copyClampedPixels(
      await normalizer.transform(new Uint8ClampedArray(pattern.data), width, height)
    ), width, height),
    0,
    0
  );
  return canvas.convertToBlob({ type: 'image/png' });
};

const serializePatterns = async (
  layers: readonly Layer[] | undefined,
  normalizer: PsdPixelNormalizer
): Promise<PsdPatternDto[]> => {
  const patterns = new Map<string, PatternInfo>();
  const visit = (nodes: readonly Layer[] | undefined) => {
    nodes?.forEach((layer) => {
      layer.patterns?.forEach((pattern) => patterns.set(pattern.id, pattern));
      visit(layer.children);
    });
  };
  visit(layers);
  return Promise.all([...patterns.values()].map(async (pattern) => ({
    id: pattern.id,
    name: pattern.name,
    width: pattern.bounds.w,
    height: pattern.bounds.h,
    pixels: await patternBlob(pattern, normalizer)
  })));
};

const layerKind = (layer: Layer): PsdLayerNodeDto['kind'] => {
  if (layer.children) return 'group';
  if (layer.adjustment) return 'adjustment';
  if (layer.text) return 'text';
  if (layer.placedLayer) return 'smart-object';
  if (layer.vectorFill || layer.vectorMask || layer.vectorStroke) return 'vector';
  return 'raster';
};

const summarizePixels = (
  data: NonNullable<Layer['imageData']>,
  bitsPerChannel: number
): NonNullable<PsdLayerNodeDto['pixelSummary']> => {
  const maximum = bitsPerChannel === 32 ? 1 : bitsPerChannel === 16 ? 65_535 : 255;
  let nonTransparentPixels = 0;
  let maximumAlpha = 0;
  for (let index = 3; index < data.data.length; index += 4) {
    const alpha = Number(data.data[index]);
    if (alpha > 0) nonTransparentPixels += 1;
    maximumAlpha = Math.max(maximumAlpha, alpha);
  }
  return {
    width: data.width,
    height: data.height,
    nonTransparentPixels,
    maximumAlpha: maximum > 0 ? maximumAlpha / maximum : 0
  };
};

const preservedMaskDescriptor = (mask: Layer['realMask']) => {
  if (!mask) return null;
  const { imageData: _imageData, canvas: _canvas, ...descriptor } = mask;
  return descriptor;
};

const serializeLayers = async (
  layers: readonly Layer[] | undefined,
  psd: Psd,
  transparentFallback: () => Promise<Blob>,
  normalizer: PsdPixelNormalizer
): Promise<PsdLayerNodeDto[]> => {
  const result: PsdLayerNodeDto[] = [];
  // ag-psd exposes siblings bottom first, matching LightTable's render stack.
  // The Layers panel reverses that storage order for Photoshop-style top-first
  // presentation. Reversing here would invert both rendering and the panel.
  for (const layer of layers ?? []) {
    const left = Math.trunc(layer.left ?? 0);
    const top = Math.trunc(layer.top ?? 0);
    const imageData = layer.imageData;
    const right = Math.trunc(layer.right ?? left + (imageData?.width ?? 0));
    const bottom = Math.trunc(layer.bottom ?? top + (imageData?.height ?? 0));
    const id = `psd-layer-${layer.id ?? crypto.randomUUID()}`;
    // Photoshop writes a "real" mask channel for the rasterized result of
    // vector/combined masks. Prefer it when present; the ordinary user mask
    // remains preserved in the descriptor bag for future independent editing.
    const effectiveMask = layer.realMask?.imageData ? layer.realMask : layer.mask;
    const maskData = effectiveMask?.imageData;
    const kind = layerKind(layer);
    const needsSemanticPlaceholder = (
      !imageData
      && kind !== 'group'
      && kind !== 'adjustment'
    );
    result.push({
      id,
      name: layer.name?.trim() || 'Layer',
      kind,
      visible: !layer.hidden,
      opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)),
      fillOpacity: Math.max(0, Math.min(1, layer.fillOpacity ?? 1)),
      blendMode: layer.blendMode ?? 'normal',
      clipping: Boolean(layer.clipping),
      transparencyProtected: Boolean(layer.transparencyProtected || layer.protected?.transparency),
      bounds: { left, top, right, bottom },
      pixelSummary: imageData
        ? summarizePixels(imageData, psd.bitsPerChannel ?? 8)
        : null,
      pixels: imageData
        // Keep raster previews layer-local. Expanding every small Photoshop
        // layer to a document-sized intermediate here multiplied both transfer
        // work and the retained RGBA16 GPU footprint by the layer count.
        ? await layerImageDataBlob(imageData, psd.bitsPerChannel ?? 8, normalizer)
        : needsSemanticPlaceholder ? await transparentFallback() : null,
      rasterFallback: imageData
        ? 'layer-preview'
        : needsSemanticPlaceholder ? 'transparent-placeholder' : null,
      mask: maskData ? {
        id: `${id}-mask`,
        source: effectiveMask === layer.realMask ? 'real-mask' : 'user-mask',
        pixels: await imageDataBlob(
          maskData,
          psd.bitsPerChannel ?? 8,
          psd.width,
          psd.height,
          Math.trunc(effectiveMask?.left ?? 0),
          Math.trunc(effectiveMask?.top ?? 0),
          true,
          effectiveMask?.defaultColor ?? 0
        ),
        enabled: !effectiveMask?.disabled,
        defaultColor: effectiveMask?.defaultColor ?? 0,
        density: effectiveMask === layer.realMask
          ? layer.mask?.vectorMaskDensity ?? 1
          : effectiveMask?.userMaskDensity ?? 1,
        feather: effectiveMask === layer.realMask
          ? layer.mask?.vectorMaskFeather ?? 0
          : effectiveMask?.userMaskFeather ?? 0
      } : null,
      effects: layer.effects ?? null,
      adjustment: layer.adjustment ?? null,
      preserved: {
        text: layer.text ?? null,
        placedLayer: layer.placedLayer ?? null,
        vectorFill: layer.vectorFill ?? null,
        vectorMask: layer.vectorMask ?? null,
        vectorStroke: layer.vectorStroke ?? null,
        vectorOrigination: layer.vectorOrigination ?? null,
        usingAlignedRendering: layer.usingAlignedRendering ?? null,
        referencePoint: layer.referencePoint ?? null,
        realMask: preservedMaskDescriptor(layer.realMask)
      },
      children: await serializeLayers(layer.children, psd, transparentFallback, normalizer)
    });
  }
  return result;
};

self.onmessage = async ({ data }: MessageEvent<PsdWorkerRequest>) => {
  let response: PsdWorkerResponse;
  try {
    const totalStartedAt = performance.now();
    publishProgress(data.requestId, 'worker-received');
    initializeAgPsdCanvas();
    publishProgress(data.requestId, 'canvas-ready');
    const warnings: string[] = [];
    const colorProfile = readPsdColorProfile(data.bytes);
    publishProgress(data.requestId, 'parsing');
    const parseStartedAt = performance.now();
    const psd = readPsd(data.bytes, {
      useImageData: true,
      skipLayerImageData: false,
      skipThumbnail: true,
      useRawThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: MAX_DECODED_BYTES,
      logMissingFeatures: true,
      log: (message) => warnings.push(String(message))
    });
    applyPsdVibranceDescriptorExtensions(
      psd.children,
      readPsdVibranceDescriptorExtensions(data.bytes)
    );
    const parseMs = performance.now() - parseStartedAt;
    try {
      recoverPsdGlobalTextPaths(psd);
    } catch (error) {
      warnings.push(
        `Photoshop global text paths could not be recovered: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    publishProgress(data.requestId, 'parsed');
    validateDocument(psd);
    const pixelNormalizer = await createPsdPixelNormalizer(colorProfile);
    if (colorProfile.disposition === 'embedded') {
      warnings.push(`Embedded ${colorProfile.name ?? 'ICC profile'} normalized to sRGB.`);
    }
    const inventory = emptyInventory();
    inspectLayers(psd.children, inventory);
    publishProgress(data.requestId, 'validated');
    let transparentFallback: Promise<Blob> | null = null;
    publishProgress(data.requestId, 'serializing-layers');
    const layerSerializationStartedAt = performance.now();
    const layers = await serializeLayers(
      psd.children,
      psd,
      () => transparentFallback ??= transparentDocumentBlob(psd.width, psd.height),
      pixelNormalizer
    );
    const layerSerializationMs = performance.now() - layerSerializationStartedAt;
    publishProgress(data.requestId, 'layers-ready');
    publishProgress(data.requestId, 'creating-preview');
    const previewStartedAt = performance.now();
    const preview = await createPreview(psd, pixelNormalizer);
    const previewMs = performance.now() - previewStartedAt;
    publishProgress(data.requestId, 'preview-ready');
    publishProgress(data.requestId, 'serializing-patterns');
    const patternSerializationStartedAt = performance.now();
    const patterns = await serializePatterns(psd.children, pixelNormalizer);
    const patternSerializationMs = performance.now() - patternSerializationStartedAt;
    publishProgress(data.requestId, 'complete');
    response = {
      kind: 'decoded-psd',
      requestId: data.requestId,
      preview,
      width: psd.width,
      height: psd.height,
      bitsPerChannel: psd.bitsPerChannel ?? 8,
      resolutionPpi: (() => {
        const info = psd.imageResources?.resolutionInfo;
        if (!info) return 72;
        const value = info.horizontalResolutionUnit === 'PPCM'
          ? info.horizontalResolution * 2.54
          : info.horizontalResolution;
        return Number.isFinite(value) && value >= 1 && value <= 2400 ? value : 72;
      })(),
      colorMode: COLOR_MODE_NAMES[psd.colorMode ?? 3] ?? `mode ${psd.colorMode}`,
      colorProfile: {
        disposition: colorProfile.disposition,
        name: colorProfile.name,
        normalizedToSrgb: pixelNormalizer.normalizedToSrgb
      },
      inventory,
      layers,
      patterns,
      engineData: psd.engineData ?? null,
      warnings,
      timings: {
        parseMs,
        layerSerializationMs,
        previewMs,
        patternSerializationMs,
        totalMs: performance.now() - totalStartedAt
      }
    };
  } catch (reason) {
    response = {
      kind: 'error',
      requestId: data.requestId,
      message: reason instanceof Error ? reason.message : 'The Photoshop document could not be decoded.'
    };
  }
  self.postMessage(response);
};
