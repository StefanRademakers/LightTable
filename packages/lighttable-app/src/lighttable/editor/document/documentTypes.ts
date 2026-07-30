import type { BlendMode } from './blendModes';
import type { AffineMatrix } from '../rendering/renderContract';
import { identityAffineMatrix } from '../rendering/renderContract';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import type { LayerStyleStack } from '../styles/layerStyleTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';

export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type LayerId = string & { readonly __brand: 'LayerId' };
export type DocumentAssetId = string & { readonly __brand: 'DocumentAssetId' };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RasterPixelSource =
  | { kind: 'imported-image'; assetId: string }
  | { kind: 'runtime-raster'; runtimeId: string };

export interface NormalizedImportProvenance {
  decoder: 'browser' | 'wasm-vips' | 'ag-psd';
  sourceBitDepth: number | null;
  sourceFormat: string | null;
  sourceInterpretation: string | null;
  sourceProfile: 'embedded ICC -> sRGB' | 'no embedded ICC; assumed sRGB' | null;
  normalizedColorSpace: 'linear-srgb';
}

export interface LayerLocks {
  transparency: boolean;
  pixels: boolean;
  position: boolean;
  all: boolean;
}

/**
 * Source semantics retained for PSD verification and future native editing.
 * LightTable rendering never reads this bag directly; import adapters map
 * supported properties onto canonical fields and preserve the rest here.
 */
export interface PhotoshopLayerMetadata {
  sourceKind: 'raster' | 'group' | 'adjustment' | 'text' | 'smart-object' | 'vector';
  sourceBlendMode: string;
  bounds: Rect;
  mask: {
    defaultColor: number;
    density: number;
    feather: number;
  } | null;
  effects: unknown | null;
  adjustment: unknown | null;
  preserved: {
    text: unknown | null;
    placedLayer: unknown | null;
    vectorFill: unknown | null;
    vectorMask: unknown | null;
    vectorStroke: unknown | null;
    realMask: unknown | null;
  };
}

export type PhotoshopImportSupport =
  | 'native'
  | 'approximate'
  | 'preserved'
  | 'raster-preview'
  | 'placeholder';

export interface PhotoshopImportCompatibilityEntry {
  path: string;
  feature: 'node' | 'blend-mode' | 'mask' | 'layer-style' | 'adjustment';
  support: PhotoshopImportSupport;
  reason: string;
}

export interface PhotoshopImportReport {
  warnings: string[];
  compatibility: PhotoshopImportCompatibilityEntry[];
}

export interface CommonLayer {
  id: LayerId;
  type: string;
  name: string;
  visible: boolean;
  locks: LayerLocks;
  opacity: number;
  /** Content opacity, separate from effects once layer styles are available. */
  fillOpacity: number;
  blendMode: BlendMode;
  /** Clip this layer to the alpha of the nearest unclipped layer below it. */
  clipping: boolean;
  /** Photoshop-compatible effects evaluated from this layer's content/alpha. */
  styleStack: LayerStyleStack;
  /** Maps this node's local coordinates into its parent coordinate space. */
  transform: AffineMatrix;
  revision: number;
  geometryRevision: number;
  createdAt: number;
  modifiedAt: number;
  /** Present only for nodes imported from Photoshop documents. */
  photoshop?: PhotoshopLayerMetadata | null;
}

export interface RasterLayer extends CommonLayer {
  type: 'raster';
  /**
   * Non-destructive corrections owned by this raster layer.
   *
   * `null` is an exact bypass: the layer has no local grade and allocates no
   * grade-specific GPU resources. Whole-document corrections are represented
   * by an explicit AdjustmentLayer instead of hidden document state.
   */
  adjustmentStack: AdjustmentStack | null;
  pixelRevision: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pixelSource: RasterPixelSource;
  dirtyBounds: Rect | null;
  mask: RasterMask | null;
}

export interface GroupLayer extends CommonLayer {
  type: 'group';
  /** Bottom-most child first, matching the document root ordering. */
  children: LayerNode[];
  compositing: 'pass-through' | 'isolated';
  mask: RasterMask | null;
}

export interface AdjustmentLayer extends CommonLayer {
  type: 'adjustment';
  adjustmentStack: AdjustmentStack;
  mask: RasterMask | null;
}

export type LayerNode = RasterLayer | GroupLayer | AdjustmentLayer;

export const createDefaultLayerLocks = (): LayerLocks => ({
  transparency: false,
  pixels: false,
  position: false,
  all: false
});

export const layerIsLocked = (
  layer: CommonLayer,
  kind: Exclude<keyof LayerLocks, 'all'> = 'pixels'
) => layer.locks.all || layer.locks[kind];

export interface RasterMask {
  id: string;
  enabled: boolean;
  /** Photoshop-compatible mask strength. 1 preserves the authored mask; 0 reveals the layer. */
  density: number;
  /** Feather radius in document pixels. */
  feather: number;
  revision: number;
  pixelRevision: number;
  dirtyBounds: Rect | null;
}

export interface ImageDocument {
  id: DocumentId;
  name: string;
  width: number;
  height: number;
  /** Root nodes, bottom-most first; groups recursively use the same ordering. */
  layers: LayerNode[];
  activeLayerId: LayerId | null;
  importProvenance: NormalizedImportProvenance | null;
  /** Persisted semantic import audit; never inferred from the flat preview. */
  photoshopImportReport: PhotoshopImportReport | null;
  /** Shared immutable resources referenced by styles, fills and future PSD nodes. */
  assets: DocumentAssetRegistry;
  revision: number;
  createdAt: number;
  modifiedAt: number;
}

export interface PatternAsset {
  id: DocumentAssetId;
  name: string;
  width: number;
  height: number;
  revision: number;
}

export interface PreservedSourceAsset {
  id: DocumentAssetId;
  kind: 'photoshop-document';
  name: string;
  mediaType: string;
  byteLength: number;
}

export interface DocumentAssetRegistry {
  patterns: PatternAsset[];
  /** Immutable source files retained for lossless future round-tripping. */
  preservedSources: PreservedSourceAsset[];
}

const opaqueId = <T extends string>(prefix: string) =>
  `${prefix}-${crypto.randomUUID()}` as T;

export const createLayerId = () => opaqueId<LayerId>('layer');

const createCommonLayer = (
  type: CommonLayer['type'],
  name: string
): CommonLayer => {
  const now = Date.now();
  return {
    id: createLayerId(),
    type,
    name,
    visible: true,
    locks: createDefaultLayerLocks(),
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    clipping: false,
    styleStack: createDefaultLayerStyleStack(),
    transform: identityAffineMatrix(),
    revision: 0,
    geometryRevision: 0,
    createdAt: now,
    modifiedAt: now
  };
};

export const createGroupLayer = (name = 'Group'): GroupLayer => ({
  ...createCommonLayer('group', name),
  type: 'group',
  children: [],
  compositing: 'pass-through',
  mask: null
});

export const createAdjustmentLayer = (
  adjustmentStack: AdjustmentStack,
  name = 'Adjustment'
): AdjustmentLayer => ({
  ...createCommonLayer('adjustment', name),
  type: 'adjustment',
  adjustmentStack: structuredClone(adjustmentStack),
  mask: null
});

export const createImageDocument = (
  name: string,
  width: number,
  height: number,
  assetId: string,
  importProvenance: NormalizedImportProvenance | null = null
): ImageDocument => {
  const now = Date.now();
  const backgroundId = createLayerId();
  return {
    id: opaqueId<DocumentId>('document'),
    name,
    width,
    height,
    layers: [{
      id: backgroundId,
      type: 'raster',
      name: 'Background',
      visible: true,
      locks: createDefaultLayerLocks(),
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      clipping: false,
      styleStack: createDefaultLayerStyleStack(),
      revision: 0,
      pixelRevision: 0,
      geometryRevision: 0,
      createdAt: now,
      modifiedAt: now,
      width,
      height,
      offsetX: 0,
      offsetY: 0,
      transform: identityAffineMatrix(),
      pixelSource: { kind: 'imported-image', assetId },
      adjustmentStack: null,
      dirtyBounds: null,
      mask: null
    }],
    activeLayerId: backgroundId,
    importProvenance,
    photoshopImportReport: null,
    assets: { patterns: [], preservedSources: [] },
    revision: 0,
    createdAt: now,
    modifiedAt: now
  };
};
