import type { BlendMode } from './blendModes';
import type { AffineMatrix } from '../geometry/affine';
import { identityAffineMatrix } from '../geometry/affine';
import type { AdjustmentStack } from '../../processing/adjustmentStack';
import type { LayerStyleStack } from '../styles/layerStyleTypes';
import { createDefaultLayerStyleStack } from '../styles/layerStyleDefaults';
import {
  cloneVectorElement,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import {
  cloneTextLayerData,
  type FontAssetRef,
  type TextLayer as TextLayerContract,
  type TextLayerData
} from '@lighttable/text-core';

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
  decoder: 'browser' | 'wasm-vips' | 'ag-psd' | 'pdfjs';
  sourceBitDepth: number | null;
  sourceFormat: string | null;
  sourceInterpretation: string | null;
  sourceProfile: 'embedded ICC -> sRGB' | 'no embedded ICC; assumed sRGB' | null;
  sourceProfileName?: string | null;
  normalizedColorSpace: 'linear-srgb';
}

export type DocumentBitDepth = 8 | 16 | 32;
export type DocumentBlendProfile = 'srgb' | 'adobe-rgb-1998';

/**
 * Authoritative document color semantics.
 *
 * This is deliberately independent from the GPU texture format. LightTable
 * may keep a document in linear rgba16float while its authored/export depth
 * remains 8 or 16 bits per channel. Blend behavior is a renderer contract and
 * is therefore not represented as a user-selectable compatibility flag.
 */
export interface DocumentColorSettings {
  mode: 'rgb';
  bitDepth: DocumentBitDepth;
  workingProfile: 'srgb';
  /** Encoded profile domain used by Photoshop/PDF-compatible blend equations. */
  blendProfile: DocumentBlendProfile;
  profileState: 'assigned' | 'assumed';
}

export const documentBitDepth = (value: number | null | undefined): DocumentBitDepth =>
  value === 8 || value === 16 || value === 32 ? value : 16;

export const createDocumentColorSettings = (
  provenance: NormalizedImportProvenance | null = null
): DocumentColorSettings => ({
  mode: 'rgb',
  bitDepth: documentBitDepth(provenance?.sourceBitDepth),
  workingProfile: 'srgb',
  blendProfile: 'srgb',
  profileState: provenance !== null && (
    provenance.sourceProfile === 'no embedded ICC; assumed sRGB'
    || provenance.sourceProfile === null
  )
    ? 'assumed'
    : 'assigned'
});

export interface LayerLocks {
  transparency: boolean;
  pixels: boolean;
  position: boolean;
  all: boolean;
}

/**
 * Bounded, derived pixels retained beside an authoritative semantic layer.
 *
 * The preview is never editing authority. It may be presented only while its
 * dependency key still matches the current semantic payload; any authoritative
 * edit makes the renderer fall through to the native text/vector path.
 */
export interface DerivedLayerPreview {
  width: number;
  height: number;
  /** Maps preview-local pixels into the layer's parent/document space. */
  transform: AffineMatrix;
  dependencyKey: string;
  source: 'photoshop-layer-preview' | 'imported-semantic-preview';
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
    vectorOrigination?: unknown | null;
    usingAlignedRendering?: boolean | null;
    referencePoint?: unknown | null;
    realMask: unknown | null;
  };
}

export type PhotoshopImportSupport =
  | 'native'
  | 'approximate'
  | 'preserved'
  | 'raster-preview'
  | 'placeholder';

export interface PhotoshopImportParity {
  visual: 'exact' | 'approximate' | 'raster-preview' | 'missing' | 'unverified';
  semantic: 'editable' | 'approximate' | 'preserved' | 'unsupported';
  structural: 'native' | 'preserved' | 'unsupported';
  roundTrip: 'verified' | 'preserved' | 'unsupported' | 'unverified';
}

export interface PhotoshopImportCompatibilityEntry {
  path: string;
  feature: 'node' | 'blend-mode' | 'mask' | 'layer-style' | 'adjustment' | 'text';
  support: PhotoshopImportSupport;
  reason: string;
  /** Independent fidelity axes; optional for legacy LightTable documents. */
  parity?: PhotoshopImportParity;
  /** Native layer target used by the existing compatibility-report actions. */
  layerId?: LayerId;
  editable?: boolean;
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
  /** Optional fidelity cache for semantic content that is not yet exact. */
  derivedPreview?: DerivedLayerPreview | null;
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

/**
 * Native resolution-independent artwork.
 *
 * Path transforms map path-local coordinates into this layer's local space;
 * the common layer transform then maps the complete layer into its parent.
 * Keeping those two stages explicit is required for nested groups, stable
 * gizmos and non-destructive editing.
 */
export interface VectorLayer extends CommonLayer {
  type: 'vector';
  /** Semantic role; gradient fills remain vectors but are not generic shape artwork. */
  role?: 'artwork' | 'gradient-fill';
  /** Four-sample edge antialiasing for native fill and stroke rasterization. */
  antiAlias: boolean;
  /**
   * Canonical editable vector artwork. Live shapes remain parametric here;
   * renderers may realize them to temporary paths but must never write that
   * derived geometry back into the document.
   */
  elements: VectorElement[];
  mask: RasterMask | null;
}

/** Native text composes the frozen text payload with the existing layer base. */
export type TextLayer = TextLayerContract<CommonLayer> & {
  readonly type: 'text';
  text: TextLayerData;
  mask: RasterMask | null;
};

/** Path-editing projection; live shapes require an explicit Convert to Path. */
export const vectorPathElements = (layer: VectorLayer): VectorPath[] =>
  layer.elements.filter((element): element is VectorPath => element.type === 'path');

export type LayerNode = RasterLayer | GroupLayer | AdjustmentLayer | VectorLayer | TextLayer;

export const semanticLayerDependencyKey = (layer: LayerNode): string | null => {
  if (layer.type === 'text') {
    const revisions = layer.text.revisions;
    return `text:${revisions.content}:${revisions.font}:${revisions.layout}:${revisions.paint}:${revisions.path}:${revisions.geometry}`;
  }
  if (layer.type === 'vector') {
    return `vector:${layer.elements.map((element) => [
      element.id,
      element.geometryRevision,
      element.transformRevision,
      element.styleRevision
    ].join(':')).join('|')}`;
  }
  return null;
};

export const layerDerivedPreviewIsCurrent = (layer: LayerNode) => Boolean(
  layer.derivedPreview
  && semanticLayerDependencyKey(layer) === layer.derivedPreview.dependencyKey
);

export const layerSupportsPixelEditing = (
  layer: LayerNode
): layer is RasterLayer => layer.type === 'raster';

export const layerSupportsLayerStyles = (layer: LayerNode): boolean => (
  layer.type === 'raster' || layer.type === 'vector'
  || layer.type === 'text' || layer.type === 'group'
);

export const layerSupportsRasterMask = (_layer: LayerNode): boolean => true;

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
  colorSettings: DocumentColorSettings;
  importProvenance: NormalizedImportProvenance | null;
  /** Persisted semantic import audit; never inferred from the flat preview. */
  photoshopImportReport: PhotoshopImportReport | null;
  /** Document-level Photoshop resources needed for lossless semantic export. */
  photoshopDocument: {
    /** Global TextFrameSet resource used by Photoshop text-on-path layers. */
    engineData: string | null;
  } | null;
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
  kind: 'photoshop-document' | 'pdf-document' | 'illustrator-document';
  name: string;
  mediaType: string;
  byteLength: number;
}

export interface DocumentFontAsset extends FontAssetRef {
  readonly familyNames: readonly string[];
  readonly styleName: string;
  readonly weight: number;
  readonly stretch: number;
  readonly italic: boolean;
  readonly byteLength: number;
  readonly variableAxes?: readonly {
    readonly tag: string;
    readonly minimum: number;
    readonly defaultValue: number;
    readonly maximum: number;
  }[];
}

export interface DocumentAssetRegistry {
  patterns: PatternAsset[];
  /** Immutable source files retained for lossless future round-tripping. */
  preservedSources: PreservedSourceAsset[];
  /** Deduplicated font faces; bytes are persisted once by fingerprint. */
  fonts: DocumentFontAsset[];
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

export const createVectorLayer = (
  elements: readonly VectorElement[] = [],
  name = 'Shape',
  role: VectorLayer['role'] = 'artwork'
): VectorLayer => ({
  ...createCommonLayer('vector', name),
  type: 'vector',
  role,
  antiAlias: true,
  elements: elements.map(cloneVectorElement),
  mask: null
});

/** Constructs the canonical native text node used by imports and authoring tools. */
export const createTextLayerNode = (
  text: TextLayerData,
  name = 'Text'
): TextLayer => ({
  ...createCommonLayer('text', name),
  type: 'text',
  text: cloneTextLayerData(text),
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
    colorSettings: createDocumentColorSettings(importProvenance),
    importProvenance,
    photoshopImportReport: null,
    photoshopDocument: null,
    assets: { patterns: [], preservedSources: [], fonts: [] },
    revision: 0,
    createdAt: now,
    modifiedAt: now
  };
};
