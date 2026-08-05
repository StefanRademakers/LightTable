export const PSD_RAW_RGBA8_MEDIA_TYPE = 'application/x-lighttable-psd-rgba8';

export interface PsdFeatureInventory {
  layers: number;
  groups: number;
  rasterPreviews: number;
  masks: number;
  layerStyles: number;
  adjustments: number;
  textLayers: number;
  smartObjects: number;
  vectorLayers: number;
  maximumDepth: number;
}

export interface PsdLayerMaskDto {
  id: string;
  pixels: Blob;
  source: 'user-mask' | 'real-mask';
  enabled: boolean;
  defaultColor: number;
  density: number;
  feather: number;
}

export interface PsdLayerNodeDto {
  id: string;
  name: string;
  kind: 'raster' | 'group' | 'adjustment' | 'text' | 'smart-object' | 'vector';
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: string;
  clipping: boolean;
  transparencyProtected: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
  pixelSummary: {
    width: number;
    height: number;
    nonTransparentPixels: number;
    maximumAlpha: number;
  } | null;
  pixels: Blob | null;
  rasterFallback: 'layer-preview' | 'transparent-placeholder' | null;
  mask: PsdLayerMaskDto | null;
  effects: unknown | null;
  adjustment: unknown | null;
  preserved: {
    text: unknown | null;
    placedLayer: unknown | null;
    vectorFill: unknown | null;
    vectorMask: unknown | null;
    vectorStroke: unknown | null;
    vectorOrigination?: unknown | null;
    usingAlignedRendering?: boolean | null;
    referencePoint?: unknown | null;
    realMask: unknown | null;
  };
  children: PsdLayerNodeDto[];
}

export interface PsdPatternDto {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: Blob;
}

export interface PsdDecodeRequest {
  kind: 'decode-psd';
  requestId: number;
  bytes: ArrayBuffer;
}

export interface PsdDecodeSuccess {
  kind: 'decoded-psd';
  requestId: number;
  preview: Blob;
  width: number;
  height: number;
  bitsPerChannel: number;
  colorMode: string;
  colorProfile: {
    disposition: 'untagged' | 'embedded';
    name: string | null;
    normalizedToSrgb: boolean;
  };
  inventory: PsdFeatureInventory;
  /** Explicitly bottom-to-top at every sibling level. */
  layers: PsdLayerNodeDto[];
  patterns: PsdPatternDto[];
  /** Base64 ag-psd Txt2 payload; retained for exact text-on-path export. */
  engineData?: string | null;
  warnings: string[];
  timings?: {
    parseMs: number;
    layerSerializationMs: number;
    previewMs: number;
    patternSerializationMs: number;
    totalMs: number;
  };
}

export interface PsdDecodeFailure {
  kind: 'error';
  requestId: number;
  message: string;
}

export type PsdDecodeStage =
  | 'worker-received'
  | 'canvas-ready'
  | 'parsing'
  | 'parsed'
  | 'validated'
  | 'serializing-layers'
  | 'layers-ready'
  | 'creating-preview'
  | 'preview-ready'
  | 'serializing-patterns'
  | 'complete';

export interface PsdDecodeProgress {
  kind: 'progress';
  requestId: number;
  stage: PsdDecodeStage;
}

export type PsdWorkerRequest = PsdDecodeRequest;
export type PsdWorkerResponse =
  | PsdDecodeSuccess
  | PsdDecodeFailure
  | PsdDecodeProgress;
