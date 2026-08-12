import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import type {
  DocumentColorSettings,
  DocumentId,
  DocumentAssetId,
  DocumentFontAsset,
  DerivedLayerPreview,
  ImageDocument,
  LayerId,
  LayerLocks,
  LayerNode,
  NormalizedImportProvenance,
  PhotoshopImportReport,
  PhotoshopLayerMetadata,
  RasterMask
} from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';
import { parseLightTableSettings } from '../../lightTableRecipe';
import {
  cloneAdjustmentStack,
  materializeBasicAdjustments,
  type AdjustmentStack,
  type AdjustmentModuleInstance
} from '../../processing/adjustmentStack';
import { CURRENT_PROCESSING_MODULES } from '../../processing/moduleDefinitions';
import type { AffineMatrix } from '../rendering/renderContract';
import { isFiniteAffineMatrix } from '../rendering/renderContract';
import type { LayerStyleStack } from '../styles/layerStyleTypes';
import { cloneLayerStyleStack } from '../styles/layerStyleDefaults';
import { parseLayerStyleStack } from '../styles/layerStyleValidation';
import {
  cloneVectorElement,
  parseVectorElement,
  type VectorElement
} from '@lighttable/vector-core';
import {
  cloneTextLayerData,
  parseTextLayerData,
  type TextLayerData
} from '@lighttable/text-core';

const FOOTER_MAGIC = 'LTBLDOC1';
const FOOTER_SIZE = 12;
const MANIFEST_VERSION = 1 as const;
const MAX_FONT_BYTES = 64 * 1024 * 1024;
const MAX_DOCUMENT_FONT_BYTES = 256 * 1024 * 1024;

interface BinaryAssetReference {
  offset: number;
  length: number;
}

interface CommonLayerManifestEntry {
  id: string;
  name: string;
  visible: boolean;
  locks: LayerLocks;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  clipping: boolean;
  styleStack: LayerStyleStack;
  geometryRevision: number;
  transform: AffineMatrix;
  derivedPreview: (DerivedLayerPreview & { asset: BinaryAssetReference }) | null;
  photoshop: PhotoshopLayerMetadata | null;
}

interface RasterLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'raster';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  adjustmentStack: AdjustmentStack | null;
  pixel: BinaryAssetReference;
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
}

interface GroupLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'group';
  compositing: 'pass-through' | 'isolated';
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
  children: LayerManifestEntry[];
}

interface AdjustmentLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'adjustment';
  adjustmentStack: AdjustmentStack;
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
}

interface VectorLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'vector';
  role: 'artwork' | 'gradient-fill';
  antiAlias: boolean;
  elements: VectorElement[];
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
}

interface TextLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'text';
  text: TextLayerData;
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
}

type LayerManifestEntry =
  | RasterLayerManifestEntry
  | GroupLayerManifestEntry
  | AdjustmentLayerManifestEntry
  | VectorLayerManifestEntry
  | TextLayerManifestEntry;

interface LayeredDocumentManifest {
  format: 'lighttable-layered-png';
  version: typeof MANIFEST_VERSION;
  previewLength: number;
  document: {
    id: string;
    name: string;
    width: number;
    height: number; resolutionPpi: number;
    guides: Array<{ id: string; orientation: 'horizontal' | 'vertical'; position: number; color?: string }>;
    activeLayerId: string | null;
    colorSettings: DocumentColorSettings;
    importProvenance: NormalizedImportProvenance | null;
    photoshopImportReport: PhotoshopImportReport | null;
    photoshopDocument: { engineData: string | null } | null;
    patterns: Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      revision: number;
      asset: BinaryAssetReference;
    }>;
    preservedSources: Array<{
      id: string;
      kind: 'photoshop-document' | 'pdf-document' | 'illustrator-document';
      name: string;
      mediaType: string;
      byteLength: number;
      asset: BinaryAssetReference;
    }>;
    fonts: Array<DocumentFontAsset & { asset: BinaryAssetReference | null }>;
    layers: LayerManifestEntry[];
  };
  adjustmentStack: AdjustmentStack;
}

export interface LayerAssetBlobs {
  layerId: LayerId;
  /** Optional document-space placement used by interchange exporters. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Empty for non-raster nodes that only contribute a persisted mask. */
  pixels: Blob;
  mask: Blob | null;
}

export interface PatternAssetBlob {
  patternId: DocumentAssetId;
  source: Blob;
}

export interface PreservedSourceAssetBlob {
  sourceId: DocumentAssetId;
  source: Blob;
}

export interface FontAssetBlob {
  fingerprintSha256: string;
  source: Blob;
}

export type DocumentAssetBlob =
  | LayerAssetBlobs
  | PatternAssetBlob
  | PreservedSourceAssetBlob
  | FontAssetBlob;

export interface ParsedLayeredDocument {
  document: ImageDocument;
  adjustmentStack: AdjustmentStack;
  preview: Blob;
  assets: LayerAssetBlobs[];
  patternAssets: PatternAssetBlob[];
  preservedSourceAssets: PreservedSourceAssetBlob[];
  fontAssets: FontAssetBlob[];
}

const encodeText = (value: string) => new TextEncoder().encode(value);
const decodeText = (value: ArrayBuffer) => new TextDecoder().decode(value);
const sha256Hex = async (value: Blob) => [...new Uint8Array(
  await crypto.subtle.digest('SHA-256', await value.arrayBuffer())
)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBlendMode = (value: unknown): value is BlendMode => BLEND_MODES.some((mode) => mode.id === value);
const isPreservedSourceKind = (value: unknown): value is ImageDocument['assets']['preservedSources'][number]['kind'] =>
  value === 'photoshop-document' || value === 'pdf-document' || value === 'illustrator-document';

const buildFooter = (manifestLength: number) => {
  const footer = new Uint8Array(FOOTER_SIZE);
  footer.set(encodeText(FOOTER_MAGIC), 0);
  new DataView(footer.buffer).setUint32(8, manifestLength, true);
  return footer;
};

export const buildLayeredDocumentFile = (
  preview: Blob,
  document: ImageDocument,
  adjustmentStack: AdjustmentStack,
  assets: DocumentAssetBlob[],
  fileName: string
) => {
  const assetsByLayer = new Map(
    assets
      .filter((asset): asset is LayerAssetBlobs => 'layerId' in asset)
      .map((asset) => [asset.layerId, asset])
  );
  const assetsByPattern = new Map(
    assets
      .filter((asset): asset is PatternAssetBlob => 'patternId' in asset)
      .map((asset) => [asset.patternId, asset])
  );
  const assetsByPreservedSource = new Map(
    assets
      .filter((asset): asset is PreservedSourceAssetBlob => 'sourceId' in asset)
      .map((asset) => [asset.sourceId, asset])
  );
  const assetsByFontFingerprint = new Map(
    assets
      .filter((asset): asset is FontAssetBlob => 'fingerprintSha256' in asset)
      .map((asset) => [asset.fingerprintSha256, asset])
  );
  let offset = preview.size;
  const binaryParts: Blob[] = [];
  const serializeLayer = (layer: LayerNode): LayerManifestEntry => {
    const layerAsset = assetsByLayer.get(layer.id);
    let derivedPreview: CommonLayerManifestEntry['derivedPreview'] = null;
    if (layer.derivedPreview) {
      if (layer.type !== 'text' && layer.type !== 'vector') {
        throw new Error(`Layer ${layer.name} cannot own a semantic derived preview.`);
      }
      if (!layerAsset?.pixels.size) {
        throw new Error(`Derived preview pixels are missing for ${layer.name}.`);
      }
      derivedPreview = {
        ...structuredClone(layer.derivedPreview),
        asset: { offset, length: layerAsset.pixels.size }
      };
      binaryParts.push(layerAsset.pixels);
      offset += layerAsset.pixels.size;
    }
    const common: CommonLayerManifestEntry = {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locks: layer.locks,
      opacity: layer.opacity,
      fillOpacity: layer.fillOpacity,
      blendMode: layer.blendMode,
      clipping: layer.clipping,
      styleStack: cloneLayerStyleStack(layer.styleStack),
      geometryRevision: layer.geometryRevision,
      transform: layer.transform,
      derivedPreview,
      photoshop: layer.photoshop ? structuredClone(layer.photoshop) : null
    };
    if (layer.type === 'group') {
      const asset = assetsByLayer.get(layer.id);
      let mask: GroupLayerManifestEntry['mask'] = null;
      if (layer.mask && asset?.mask) {
        mask = {
          id: layer.mask.id,
          enabled: layer.mask.enabled,
          density: layer.mask.density,
          feather: layer.mask.feather,
          asset: { offset, length: asset.mask.size }
        };
        binaryParts.push(asset.mask);
        offset += asset.mask.size;
      }
      return {
        ...common,
        type: 'group',
        compositing: layer.compositing,
        mask,
        children: layer.children.map(serializeLayer)
      };
    }
    if (layer.type === 'adjustment') {
      const asset = assetsByLayer.get(layer.id);
      let mask: AdjustmentLayerManifestEntry['mask'] = null;
      if (layer.mask && asset?.mask) {
        mask = {
          id: layer.mask.id,
          enabled: layer.mask.enabled,
          density: layer.mask.density,
          feather: layer.mask.feather,
          asset: { offset, length: asset.mask.size }
        };
        binaryParts.push(asset.mask);
        offset += asset.mask.size;
      }
      return {
        ...common,
        type: 'adjustment',
        adjustmentStack: cloneAdjustmentStack(layer.adjustmentStack),
        mask
      };
    }
    if (layer.type === 'vector') {
      const asset = assetsByLayer.get(layer.id);
      let mask: VectorLayerManifestEntry['mask'] = null;
      if (layer.mask && asset?.mask) {
        mask = {
          id: layer.mask.id,
          enabled: layer.mask.enabled,
          density: layer.mask.density,
          feather: layer.mask.feather,
          asset: { offset, length: asset.mask.size }
        };
        binaryParts.push(asset.mask);
        offset += asset.mask.size;
      }
      return {
        ...common,
        type: 'vector',
        role: layer.role ?? 'artwork',
        antiAlias: layer.antiAlias,
        elements: layer.elements.map(cloneVectorElement),
        mask
      };
    }
    if (layer.type === 'text') {
      const asset = assetsByLayer.get(layer.id);
      let mask: TextLayerManifestEntry['mask'] = null;
      if (layer.mask && asset?.mask) {
        mask = {
          id: layer.mask.id,
          enabled: layer.mask.enabled,
          density: layer.mask.density,
          feather: layer.mask.feather,
          asset: { offset, length: asset.mask.size }
        };
        binaryParts.push(asset.mask);
        offset += asset.mask.size;
      }
      return {
        ...common,
        type: 'text',
        text: cloneTextLayerData(layer.text),
        mask
      };
    }

    const asset = assetsByLayer.get(layer.id);
    if (!asset) throw new Error(`Layer asset is missing for ${layer.name}.`);
    if (!asset.pixels) throw new Error(`Layer pixels are missing for ${layer.name}.`);
    const pixel = { offset, length: asset.pixels.size };
    binaryParts.push(asset.pixels);
    offset += asset.pixels.size;
    let mask: RasterLayerManifestEntry['mask'] = null;
    if (layer.mask && asset.mask) {
      mask = {
        id: layer.mask.id,
        enabled: layer.mask.enabled,
        density: layer.mask.density,
        feather: layer.mask.feather,
        asset: { offset, length: asset.mask.size }
      };
      binaryParts.push(asset.mask);
      offset += asset.mask.size;
    }
    return {
      ...common,
      type: 'raster',
      width: layer.width,
      height: layer.height,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      adjustmentStack: layer.adjustmentStack
        ? cloneAdjustmentStack(layer.adjustmentStack)
        : null,
      pixel,
      mask
    };
  };
  const layers = document.layers.map(serializeLayer);
  const patterns = document.assets.patterns.map((pattern) => {
    const binary = assetsByPattern.get(pattern.id);
    if (!binary?.source.size) throw new Error(`Pattern asset is missing for ${pattern.name}.`);
    const asset = { offset, length: binary.source.size };
    binaryParts.push(binary.source);
    offset += binary.source.size;
    return { ...pattern, asset };
  });
  const preservedSources = document.assets.preservedSources.map((source) => {
    const binary = assetsByPreservedSource.get(source.id);
    if (!binary || binary.source.size !== source.byteLength) {
      throw new Error(`Preserved source asset is missing or inconsistent for ${source.name}.`);
    }
    const asset = { offset, length: binary.source.size };
    binaryParts.push(binary.source);
    offset += binary.source.size;
    return { ...source, asset };
  });
  const fontReferences = new Map<string, BinaryAssetReference>();
  const fonts = document.assets.fonts.map((font) => {
    if (font.source === 'system') {
      return { ...structuredClone(font), asset: null };
    }
    let asset = fontReferences.get(font.fingerprintSha256);
    if (!asset) {
      const binary = assetsByFontFingerprint.get(font.fingerprintSha256);
      if (!binary || binary.source.size !== font.byteLength) {
        throw new Error(`Font asset is missing or inconsistent for ${font.familyNames[0]}.`);
      }
      asset = { offset, length: binary.source.size };
      fontReferences.set(font.fingerprintSha256, asset);
      binaryParts.push(binary.source);
      offset += binary.source.size;
    }
    return { ...structuredClone(font), asset };
  });
  const manifest: LayeredDocumentManifest = {
    format: 'lighttable-layered-png',
    version: MANIFEST_VERSION,
    previewLength: preview.size,
    document: {
      id: document.id,
      name: document.name,
      width: document.width,
      height: document.height, resolutionPpi: document.resolutionPpi,
      guides: structuredClone(document.guides),
      activeLayerId: document.activeLayerId,
      colorSettings: structuredClone(document.colorSettings),
      importProvenance: document.importProvenance,
      photoshopImportReport: document.photoshopImportReport
        ? structuredClone(document.photoshopImportReport)
        : null,
      photoshopDocument: document.photoshopDocument
        ? structuredClone(document.photoshopDocument)
        : null,
      patterns,
      preservedSources,
      fonts,
      layers
    },
    adjustmentStack: cloneAdjustmentStack(adjustmentStack)
  };
  const manifestBytes = encodeText(JSON.stringify(manifest));
  const blob = new Blob([preview, ...binaryParts, manifestBytes, buildFooter(manifestBytes.byteLength)], { type: 'image/png' });
  const normalizedName = `${fileName.replace(/\.png$/i, '').replace(/\.lighttable$/i, '')}.lighttable.png`;
  return new File([blob], normalizedName, { type: 'image/png' });
};

const validAssetReference = (value: unknown, minimum: number, limit: number): value is BinaryAssetReference => {
  if (!isRecord(value)) return false;
  const offset = value.offset;
  const length = value.length;
  return Number.isInteger(offset) && Number.isInteger(length) && Number(offset) >= minimum && Number(length) > 0 && Number(offset) + Number(length) <= limit;
};

const parseImportProvenance = (value: unknown): NormalizedImportProvenance | null => {
  if (value === null) return null;
  if (
    !isRecord(value)
    || (
      value.decoder !== 'browser'
      && value.decoder !== 'wasm-vips'
      && value.decoder !== 'ag-psd'
      && value.decoder !== 'pdfjs'
    )
    || (value.sourceBitDepth !== null && typeof value.sourceBitDepth !== 'number')
    || (value.sourceFormat !== null && typeof value.sourceFormat !== 'string')
    || (value.sourceInterpretation !== null && typeof value.sourceInterpretation !== 'string')
    || (
      value.sourceProfile !== null
      && value.sourceProfile !== 'embedded ICC -> sRGB'
      && value.sourceProfile !== 'no embedded ICC; assumed sRGB'
    )
    || value.normalizedColorSpace !== 'linear-srgb'
  ) {
    throw new Error('The LightTable document import provenance is invalid.');
  }
  return {
    decoder: value.decoder,
    sourceBitDepth: value.sourceBitDepth,
    sourceFormat: value.sourceFormat,
    sourceInterpretation: value.sourceInterpretation,
    sourceProfile: value.sourceProfile,
    ...(typeof value.sourceProfileName === 'string' || value.sourceProfileName === null
      ? { sourceProfileName: value.sourceProfileName }
      : {}),
    normalizedColorSpace: 'linear-srgb'
  };
};

const parseDocumentColorSettings = (
  value: unknown
): DocumentColorSettings => {
  if (
    !isRecord(value)
    || value.mode !== 'rgb'
    || (value.bitDepth !== 8 && value.bitDepth !== 16 && value.bitDepth !== 32)
    || value.workingProfile !== 'srgb'
    || (value.blendProfile !== 'srgb' && value.blendProfile !== 'adobe-rgb-1998')
    || (value.profileState !== 'assigned' && value.profileState !== 'assumed')
  ) {
    throw new Error('The LightTable document color settings are invalid.');
  }
  return {
    mode: 'rgb',
    bitDepth: value.bitDepth,
    workingProfile: 'srgb',
    blendProfile: value.blendProfile === 'adobe-rgb-1998' ? 'adobe-rgb-1998' : 'srgb',
    profileState: value.profileState
  };
};

const parseResolutionPpi = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 2400) {
    throw new Error('The LightTable document resolution is invalid.');
  }
  return value;
};

const parsePhotoshopImportReport = (value: unknown): PhotoshopImportReport | null => {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.warnings) || !Array.isArray(value.compatibility)) {
    throw new Error('The LightTable Photoshop import report is invalid.');
  }
  if (!value.warnings.every((warning) => typeof warning === 'string')) {
    throw new Error('The LightTable Photoshop import warnings are invalid.');
  }
  const compatibility: PhotoshopImportReport['compatibility'] = value.compatibility.map((entry, index) => {
    if (
      !isRecord(entry)
      || typeof entry.path !== 'string'
      || (
        entry.feature !== 'node'
        && entry.feature !== 'blend-mode'
        && entry.feature !== 'mask'
        && entry.feature !== 'layer-style'
        && entry.feature !== 'adjustment'
        && entry.feature !== 'text'
      )
      || (
        entry.support !== 'native'
        && entry.support !== 'approximate'
        && entry.support !== 'preserved'
        && entry.support !== 'raster-preview'
        && entry.support !== 'placeholder'
      )
      || typeof entry.reason !== 'string'
    ) {
      throw new Error(`The LightTable Photoshop compatibility entry ${index + 1} is invalid.`);
    }
    let parity: PhotoshopImportReport['compatibility'][number]['parity'];
    if (entry.parity !== undefined) {
      if (!isRecord(entry.parity)
        || !['exact', 'approximate', 'raster-preview', 'missing', 'unverified'].includes(String(entry.parity.visual))
        || !['editable', 'approximate', 'preserved', 'unsupported'].includes(String(entry.parity.semantic))
        || !['native', 'preserved', 'unsupported'].includes(String(entry.parity.structural))
        || !['verified', 'preserved', 'unsupported', 'unverified'].includes(String(entry.parity.roundTrip))) {
        throw new Error(`The LightTable Photoshop compatibility parity ${index + 1} is invalid.`);
      }
      parity = {
        visual: entry.parity.visual as NonNullable<typeof parity>['visual'],
        semantic: entry.parity.semantic as NonNullable<typeof parity>['semantic'],
        structural: entry.parity.structural as NonNullable<typeof parity>['structural'],
        roundTrip: entry.parity.roundTrip as NonNullable<typeof parity>['roundTrip']
      };
    }
    if (entry.layerId !== undefined && typeof entry.layerId !== 'string') {
      throw new Error(`The LightTable Photoshop compatibility layer target ${index + 1} is invalid.`);
    }
    if (entry.editable !== undefined && typeof entry.editable !== 'boolean') {
      throw new Error(`The LightTable Photoshop compatibility editability ${index + 1} is invalid.`);
    }
    return {
      path: entry.path,
      feature: entry.feature as PhotoshopImportReport['compatibility'][number]['feature'],
      support: entry.support as PhotoshopImportReport['compatibility'][number]['support'],
      reason: entry.reason,
      ...(parity ? { parity } : {}),
      ...(entry.layerId !== undefined ? { layerId: entry.layerId as LayerId } : {}),
      ...(entry.editable !== undefined ? { editable: entry.editable } : {})
    };
  });
  return { warnings: [...value.warnings], compatibility };
};

const parsePhotoshopDocument = (value: unknown): ImageDocument['photoshopDocument'] => {
  if (value === null) return null;
  if (
    !isRecord(value)
    || (value.engineData !== null && typeof value.engineData !== 'string')
  ) {
    throw new Error('The LightTable Photoshop document metadata is invalid.');
  }
  return { engineData: value.engineData };
};

const parseLayerTransform = (value: unknown): AffineMatrix => {
  if (!isRecord(value)) throw new Error('The LightTable layer transform is invalid.');
  const transform: AffineMatrix = {
    a: Number(value.a),
    b: Number(value.b),
    c: Number(value.c),
    d: Number(value.d),
    tx: Number(value.tx),
    ty: Number(value.ty)
  };
  if (!isFiniteAffineMatrix(transform)) throw new Error('The LightTable layer transform is invalid.');
  return transform;
};

const parseLayerLocks = (value: unknown): LayerLocks => {
  if (
    !isRecord(value)
    || typeof value.transparency !== 'boolean'
    || typeof value.pixels !== 'boolean'
    || typeof value.position !== 'boolean'
    || typeof value.all !== 'boolean'
  ) {
    throw new Error('The LightTable layer locks are invalid.');
  }
  return {
    transparency: value.transparency,
    pixels: value.pixels,
    position: value.position,
    all: value.all
  };
};

const parseAdjustmentStack = (value: unknown): AdjustmentStack => {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !Number.isInteger(value.revision)
    || Number(value.revision) < 0
    || !Array.isArray(value.modules)
  ) {
    throw new Error('The LightTable document adjustment stack is invalid.');
  }
  const modules: AdjustmentModuleInstance[] = value.modules.map((candidate, index) => {
    if (
      !isRecord(candidate)
      || typeof candidate.id !== 'string'
      || typeof candidate.type !== 'string'
      || typeof candidate.enabled !== 'boolean'
      || !Number.isInteger(candidate.revision)
      || Number(candidate.revision) < 0
      || !isRecord(candidate.settings)
    ) {
      throw new Error(`Adjustment module ${index + 1} is invalid.`);
    }
    return {
      id: candidate.id,
      type: candidate.type,
      enabled: candidate.enabled,
      revision: Number(candidate.revision),
      settings: structuredClone(candidate.settings)
    };
  });
  const knownTypes = new Set<string>(CURRENT_PROCESSING_MODULES.map(({ type }) => type));
  const requiredBridgeTypes = CURRENT_PROCESSING_MODULES
    .filter(({ settingsPaths }) => settingsPaths.length > 0)
    .map(({ type }) => type);
  const actualTypes = modules.map(({ type }) => type);
  if (
    modules.some(({ type }) => !knownTypes.has(type))
    || new Set(modules.map(({ id }) => id)).size !== modules.length
    || requiredBridgeTypes.some((type) => !actualTypes.includes(type))
  ) {
    throw new Error('The LightTable document adjustment module inventory is invalid.');
  }
  const stack = {
    id: value.id,
    revision: Number(value.revision),
    modules
  };
  const materialized = materializeBasicAdjustments(stack);
  const parsed = parseLightTableSettings(materialized);
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(materialized)) {
    throw new Error('The LightTable document adjustment values are invalid.');
  }
  return stack;
};

export const parseLayeredDocumentFile = async (blob: Blob): Promise<ParsedLayeredDocument | null> => {
  if (blob.size < FOOTER_SIZE) return null;
  const footer = await blob.slice(blob.size - FOOTER_SIZE).arrayBuffer();
  const footerBytes = new Uint8Array(footer);
  if (new TextDecoder().decode(footerBytes.subarray(0, 8)) !== FOOTER_MAGIC) return null;
  const manifestLength = new DataView(footer).getUint32(8, true);
  const manifestStart = blob.size - FOOTER_SIZE - manifestLength;
  if (!manifestLength || manifestStart <= 0) throw new Error('The LightTable document footer is invalid.');
  let raw: unknown;
  try {
    raw = JSON.parse(decodeText(await blob.slice(manifestStart, blob.size - FOOTER_SIZE).arrayBuffer()));
  } catch {
    throw new Error('The LightTable document manifest could not be read.');
  }
  if (
    !isRecord(raw)
    || raw.format !== 'lighttable-layered-png'
    || raw.version !== MANIFEST_VERSION
    || !isRecord(raw.document)
  ) {
    throw new Error('This LightTable document format is not supported.');
  }
  const source = raw.document;
  const width = source.width;
  const height = source.height;
  const previewLength = raw.previewLength;
  if (typeof source.id !== 'string' || !source.id || typeof source.name !== 'string'
    || (source.activeLayerId !== null && typeof source.activeLayerId !== 'string')
    || !Number.isInteger(width) || !Number.isInteger(height) || Number(width) <= 0 || Number(height) <= 0 ||
    !Number.isInteger(previewLength) || Number(previewLength) <= 0 || Number(previewLength) > manifestStart || !Array.isArray(source.layers)) {
    throw new Error('The LightTable document dimensions or preview are invalid.');
  }
  const adjustmentStack = parseAdjustmentStack(raw.adjustmentStack);
  const importProvenance = parseImportProvenance(source.importProvenance);
  const colorSettings = parseDocumentColorSettings(source.colorSettings);
  const photoshopImportReport = parsePhotoshopImportReport(source.photoshopImportReport);
  const photoshopDocument = parsePhotoshopDocument(source.photoshopDocument);
  const now = Date.now();
  const assets: LayerAssetBlobs[] = [];
  const patternAssets: PatternAssetBlob[] = [];
  const preservedSourceAssets: PreservedSourceAssetBlob[] = [];
  const fontAssets: FontAssetBlob[] = [];
  const parseLayer = (entry: unknown, path: string): LayerNode => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.name !== 'string'
      || typeof entry.visible !== 'boolean'
      || typeof entry.opacity !== 'number'
      || !Number.isFinite(entry.opacity)
      || entry.opacity < 0
      || entry.opacity > 1
      || typeof entry.fillOpacity !== 'number'
      || !Number.isFinite(entry.fillOpacity)
      || entry.fillOpacity < 0
      || entry.fillOpacity > 1
      || typeof entry.clipping !== 'boolean'
      || !isBlendMode(entry.blendMode)
      || !Number.isInteger(entry.geometryRevision)
      || Number(entry.geometryRevision) < 0
      || (entry.photoshop !== null && !isRecord(entry.photoshop))
      || (
        entry.type !== 'raster'
        && entry.type !== 'group'
        && entry.type !== 'adjustment'
        && entry.type !== 'vector'
        && entry.type !== 'text'
      )
    ) {
      throw new Error(`Layer ${path} in the LightTable document is invalid.`);
    }
    const id = entry.id as LayerId;
    const parseDerivedPreview = (): { value: DerivedLayerPreview | null; blob: Blob | null } => {
      if (entry.derivedPreview === null) {
        return { value: null, blob: null };
      }
      const preview = entry.derivedPreview;
      if (
        !isRecord(preview)
        || !Number.isInteger(preview.width)
        || Number(preview.width) <= 0
        || !Number.isInteger(preview.height)
        || Number(preview.height) <= 0
        || typeof preview.dependencyKey !== 'string'
        || preview.dependencyKey.length === 0
        || (preview.source !== 'photoshop-layer-preview' && preview.source !== 'imported-semantic-preview')
        || !validAssetReference(preview.asset, Number(previewLength), manifestStart)
      ) throw new Error(`Derived preview ${path} in the LightTable document is invalid.`);
      const reference = preview.asset;
      return {
        value: {
          width: Number(preview.width),
          height: Number(preview.height),
          transform: parseLayerTransform(preview.transform),
          dependencyKey: preview.dependencyKey,
          source: preview.source
        },
        blob: blob.slice(reference.offset, reference.offset + reference.length, 'image/png')
      };
    };
    const parsedPreview = parseDerivedPreview();
    if (parsedPreview.value && entry.type !== 'text' && entry.type !== 'vector') {
      throw new Error(`Derived preview ${path} must belong to a semantic text or vector layer.`);
    }
    const common = {
      id,
      name: entry.name,
      visible: entry.visible,
      locks: parseLayerLocks(entry.locks),
      opacity: entry.opacity,
      fillOpacity: entry.fillOpacity,
      blendMode: entry.blendMode,
      clipping: entry.clipping,
      styleStack: parseLayerStyleStack(entry.styleStack),
      revision: 0,
      geometryRevision: Number(entry.geometryRevision),
      createdAt: now,
      modifiedAt: now,
      transform: parseLayerTransform(entry.transform),
      derivedPreview: parsedPreview.value,
      photoshop: isRecord(entry.photoshop)
        ? structuredClone(entry.photoshop) as unknown as PhotoshopLayerMetadata
        : null
    };
    const parseMask = (): { mask: RasterMask | null; blob: Blob | null } => {
      if (entry.mask === null || entry.mask === undefined) return { mask: null, blob: null };
      if (
        !isRecord(entry.mask)
        || typeof entry.mask.id !== 'string'
        || typeof entry.mask.enabled !== 'boolean'
        || typeof entry.mask.density !== 'number'
        || !Number.isFinite(entry.mask.density)
        || entry.mask.density < 0
        || entry.mask.density > 1
        || typeof entry.mask.feather !== 'number'
        || !Number.isFinite(entry.mask.feather)
        || entry.mask.feather < 0
        || !validAssetReference(entry.mask.asset, Number(previewLength), manifestStart)
      ) throw new Error(`Mask ${path} in the LightTable document is invalid.`);
      const maskReference = entry.mask.asset;
      return {
        mask: {
          id: entry.mask.id,
          enabled: entry.mask.enabled,
          density: entry.mask.density,
          feather: entry.mask.feather,
          revision: 0,
          pixelRevision: 0,
          dirtyBounds: null
        },
        blob: blob.slice(maskReference.offset, maskReference.offset + maskReference.length, 'image/png')
      };
    };

    if (entry.type === 'group') {
      if (
        !Array.isArray(entry.children)
        || (entry.compositing !== 'pass-through' && entry.compositing !== 'isolated')
      ) throw new Error(`Group ${path} in the LightTable document is invalid.`);
      const parsedMask = parseMask();
      if (parsedMask.blob || parsedPreview.blob) {
        assets.push({ layerId: id, pixels: parsedPreview.blob ?? new Blob(), mask: parsedMask.blob });
      }
      return {
        ...common,
        type: 'group',
        compositing: entry.compositing,
        children: entry.children.map((child, index) => parseLayer(child, `${path}.${index + 1}`)),
        mask: parsedMask.mask
      };
    }

    if (entry.type === 'adjustment') {
      const parsedMask = parseMask();
      if (parsedMask.blob || parsedPreview.blob) {
        assets.push({ layerId: id, pixels: parsedPreview.blob ?? new Blob(), mask: parsedMask.blob });
      }
      return {
        ...common,
        type: 'adjustment',
        adjustmentStack: parseAdjustmentStack(entry.adjustmentStack),
        mask: parsedMask.mask
      };
    }

    if (entry.type === 'vector') {
      if (!Array.isArray(entry.elements)) {
        throw new Error(`Vector layer ${path} in the LightTable document is invalid.`);
      }
      if (typeof entry.antiAlias !== 'boolean') {
        throw new Error(`Vector layer ${path} has an invalid anti-alias setting.`);
      }
      if (entry.role !== 'artwork' && entry.role !== 'gradient-fill') {
        throw new Error(`Vector layer ${path} has an invalid role.`);
      }
      const parsedMask = parseMask();
      if (parsedMask.blob || parsedPreview.blob) {
        assets.push({ layerId: id, pixels: parsedPreview.blob ?? new Blob(), mask: parsedMask.blob });
      }
      return {
        ...common,
        type: 'vector',
        role: entry.role,
        antiAlias: entry.antiAlias,
        elements: entry.elements.map((candidate, index) =>
          parseVectorElement(candidate, `Layer ${path} element ${index + 1}`)),
        mask: parsedMask.mask
      };
    }

    if (entry.type === 'text') {
      const parsedMask = parseMask();
      if (parsedMask.blob || parsedPreview.blob) {
        assets.push({ layerId: id, pixels: parsedPreview.blob ?? new Blob(), mask: parsedMask.blob });
      }
      let text: TextLayerData;
      try {
        text = cloneTextLayerData(parseTextLayerData(structuredClone(entry.text)));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        throw new Error(`Text layer ${path} is invalid: ${message}`);
      }
      return {
        ...common,
        type: 'text',
        text,
        mask: parsedMask.mask
      };
    }

    if (!validAssetReference(entry.pixel, Number(previewLength), manifestStart)) {
      throw new Error(`Raster layer ${path} in the LightTable document has invalid pixels.`);
    }
    const rasterWidth = entry.width;
    const rasterHeight = entry.height;
    const rasterOffsetX = entry.offsetX;
    const rasterOffsetY = entry.offsetY;
    if (
      !Number.isInteger(rasterWidth)
      || Number(rasterWidth) <= 0
      || !Number.isInteger(rasterHeight)
      || Number(rasterHeight) <= 0
      || typeof rasterOffsetX !== 'number'
      || !Number.isFinite(rasterOffsetX)
      || typeof rasterOffsetY !== 'number'
      || !Number.isFinite(rasterOffsetY)
    ) {
      throw new Error(`Raster layer ${path} in the LightTable document has invalid bounds.`);
    }
    const parsedMask = parseMask();
    const pixelReference = entry.pixel;
    assets.push({
      layerId: id,
      pixels: blob.slice(pixelReference.offset, pixelReference.offset + pixelReference.length, 'image/png'),
      mask: parsedMask.blob
    });
    return {
      ...common,
      type: 'raster',
      pixelRevision: 0,
      width: Number(rasterWidth),
      height: Number(rasterHeight),
      offsetX: rasterOffsetX,
      offsetY: rasterOffsetY,
      pixelSource: { kind: 'runtime-raster', runtimeId: id },
      adjustmentStack: entry.adjustmentStack === null
        ? null
        : parseAdjustmentStack(entry.adjustmentStack),
      dirtyBounds: null,
      mask: parsedMask.mask
    };
  };
  const layers = source.layers.map((entry, index) => parseLayer(entry, `${index + 1}`));
  if (!layers.length) throw new Error('The LightTable document contains no layers.');
  const allLayers = walkLayerTree(layers);
  if (new Set(allLayers.map(({ node }) => node.id)).size !== allLayers.length) {
    throw new Error('The LightTable document contains duplicate layer IDs.');
  }
  const activeLayerId = typeof source.activeLayerId === 'string' && allLayers.some(({ node }) => node.id === source.activeLayerId)
    ? source.activeLayerId as LayerId
    : allLayers[allLayers.length - 1].node.id;
  if (!Array.isArray(source.patterns)) {
    throw new Error('The LightTable document pattern registry is invalid.');
  }
  const patterns = source.patterns.map((entry, index) => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.name !== 'string'
      || !Number.isInteger(entry.width)
      || Number(entry.width) <= 0
      || !Number.isInteger(entry.height)
      || Number(entry.height) <= 0
      || !Number.isInteger(entry.revision)
      || Number(entry.revision) < 0
      || !validAssetReference(entry.asset, Number(previewLength), manifestStart)
    ) {
      throw new Error(`Pattern ${index + 1} in the LightTable document is invalid.`);
    }
    const reference = entry.asset;
    const id = entry.id as DocumentAssetId;
    patternAssets.push({
      patternId: id,
      source: blob.slice(reference.offset, reference.offset + reference.length)
    });
    return {
      id,
      name: entry.name,
      width: Number(entry.width),
      height: Number(entry.height),
      revision: Number(entry.revision)
    };
  });
  if (!Array.isArray(source.preservedSources)) {
    throw new Error('The LightTable document preserved-source registry is invalid.');
  }
  const preservedSources = source.preservedSources.map((entry, index) => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || !isPreservedSourceKind(entry.kind)
      || typeof entry.name !== 'string'
      || typeof entry.mediaType !== 'string'
      || !Number.isInteger(entry.byteLength)
      || Number(entry.byteLength) <= 0
      || !validAssetReference(entry.asset, Number(previewLength), manifestStart)
      || Number(entry.asset.length) !== Number(entry.byteLength)
    ) {
      throw new Error(`Preserved source ${index + 1} in the LightTable document is invalid.`);
    }
    const reference = entry.asset;
    const id = entry.id as DocumentAssetId;
    preservedSourceAssets.push({
      sourceId: id,
      source: blob.slice(reference.offset, reference.offset + reference.length, entry.mediaType)
    });
    return {
      id,
      kind: entry.kind,
      name: entry.name,
      mediaType: entry.mediaType,
      byteLength: Number(entry.byteLength)
    };
  });
  const rawFonts = source.fonts;
  if (!Array.isArray(rawFonts)) {
    throw new Error('The LightTable document font registry is invalid.');
  }
  if (rawFonts.length > 4_096) throw new Error('The LightTable document exceeds the 4096 font-reference limit.');
  const portableFaceCount = rawFonts.filter((entry) => !isRecord(entry) || entry.source !== 'system').length;
  if (portableFaceCount > 256) throw new Error('The LightTable document exceeds the 256 embedded font-face limit.');
  const budgetedFingerprints = new Set<string>();
  let budgetedFontBytes = 0;
  rawFonts.forEach((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.byteLength)) return;
    const byteLength = Number(entry.byteLength);
    if (byteLength > MAX_FONT_BYTES) {
      throw new Error('A LightTable font exceeds the 64 MiB font limit.');
    }
    if (
      byteLength > 0
      && typeof entry.fingerprintSha256 === 'string'
      && !budgetedFingerprints.has(entry.fingerprintSha256.toLowerCase())
    ) {
      budgetedFingerprints.add(entry.fingerprintSha256.toLowerCase());
      budgetedFontBytes += byteLength;
      if (budgetedFontBytes > MAX_DOCUMENT_FONT_BYTES) {
        throw new Error('The LightTable document exceeds the 256 MiB font limit.');
      }
    }
  });
  const seenFontIds = new Set<string>();
  const seenFontFingerprints = new Map<string, BinaryAssetReference>();
  let uniqueFontByteLength = 0;
  const fonts = rawFonts.map((entry, index): DocumentFontAsset => {
    if (
      !isRecord(entry)
      || typeof entry.assetId !== 'string'
      || !entry.assetId
      || entry.assetId.length > 1_024
      || seenFontIds.has(entry.assetId)
      || !Number.isSafeInteger(entry.faceIndex)
      || Number(entry.faceIndex) < 0
      || Number(entry.faceIndex) >= 64
      || typeof entry.fingerprintSha256 !== 'string'
      || !/^[a-f\d]{64}$/i.test(entry.fingerprintSha256)
      || !['bundled', 'document', 'system', 'imported', 'pdf-subset'].includes(String(entry.source))
      || !['sfnt', 'woff', 'woff2', 'raw-cff', 'unknown'].includes(String(entry.container))
      || !['truetype', 'cff', 'cff2', 'svg', 'bitmap', 'mixed', 'unknown'].includes(String(entry.outline))
      || !isRecord(entry.embedding)
      || !['installable', 'editable', 'preview-print', 'restricted', 'unknown'].includes(String(entry.embedding.level))
      || typeof entry.embedding.noSubsetting !== 'boolean'
      || typeof entry.embedding.bitmapOnly !== 'boolean'
      || !Array.isArray(entry.familyNames)
      || entry.familyNames.length < 1
      || entry.familyNames.length > 64
      || !entry.familyNames.every((name) =>
        typeof name === 'string' && name.trim() && name.length <= 1_024
      )
      || typeof entry.styleName !== 'string'
      || !entry.styleName.trim()
      || entry.styleName.length > 1_024
      || (entry.postScriptName !== undefined && (
        typeof entry.postScriptName !== 'string'
        || !entry.postScriptName.trim()
        || entry.postScriptName.length > 1_024
      ))
      || typeof entry.weight !== 'number'
      || !Number.isFinite(entry.weight)
      || entry.weight < 1
      || entry.weight > 1_000
      || typeof entry.stretch !== 'number'
      || !Number.isFinite(entry.stretch)
      || entry.stretch <= 0
      || typeof entry.italic !== 'boolean'
      || (entry.variableAxes !== undefined && (
        !Array.isArray(entry.variableAxes)
        || entry.variableAxes.length > 64
        || !entry.variableAxes.every((axis) => isRecord(axis)
          && typeof axis.tag === 'string' && /^[\x20-\x7e]{4}$/.test(axis.tag)
          && typeof axis.minimum === 'number' && Number.isFinite(axis.minimum)
          && typeof axis.defaultValue === 'number' && Number.isFinite(axis.defaultValue)
          && typeof axis.maximum === 'number' && Number.isFinite(axis.maximum)
          && Number(axis.minimum) <= Number(axis.defaultValue)
          && Number(axis.defaultValue) <= Number(axis.maximum))
      ))
      || !Number.isSafeInteger(entry.byteLength)
      || Number(entry.byteLength) < 1
      || Number(entry.byteLength) > MAX_FONT_BYTES
      || !(
        entry.source === 'system' && entry.asset === null
        || validAssetReference(entry.asset, Number(previewLength), manifestStart)
      )
      || (isRecord(entry.asset) && Number(entry.asset.length) !== Number(entry.byteLength))
    ) throw new Error(`Font ${index + 1} in the LightTable document is invalid.`);
    const reference = entry.asset;
    const fingerprint = entry.fingerprintSha256.toLowerCase();
    if (reference === null) {
      seenFontIds.add(entry.assetId);
      return {
        assetId: entry.assetId,
        faceIndex: Number(entry.faceIndex),
        fingerprintSha256: fingerprint,
        source: 'system',
        container: entry.container as DocumentFontAsset['container'],
        outline: entry.outline as DocumentFontAsset['outline'],
        ...(typeof entry.postScriptName === 'string' ? { postScriptName: entry.postScriptName } : {}),
        embedding: {
          level: entry.embedding.level as DocumentFontAsset['embedding']['level'],
          noSubsetting: entry.embedding.noSubsetting,
          bitmapOnly: entry.embedding.bitmapOnly
        },
        familyNames: [...entry.familyNames] as string[],
        styleName: entry.styleName,
        weight: Number(entry.weight),
        stretch: Number(entry.stretch),
        italic: entry.italic,
        byteLength: Number(entry.byteLength),
        ...(Array.isArray(entry.variableAxes) ? { variableAxes: structuredClone(entry.variableAxes) } : {})
      };
    }
    const existingReference = seenFontFingerprints.get(fingerprint);
    if (existingReference && (
      existingReference.offset !== reference.offset
      || existingReference.length !== reference.length
    )) throw new Error(`Font ${index + 1} duplicates bytes inconsistently.`);
    if (!existingReference) {
      uniqueFontByteLength += Number(entry.byteLength);
      if (uniqueFontByteLength > MAX_DOCUMENT_FONT_BYTES) {
        throw new Error('The LightTable document exceeds the 256 MiB font limit.');
      }
      seenFontFingerprints.set(fingerprint, reference);
      fontAssets.push({
        fingerprintSha256: fingerprint,
        source: blob.slice(reference.offset, reference.offset + reference.length, 'font/otf')
      });
    }
    seenFontIds.add(entry.assetId);
    return {
      assetId: entry.assetId,
      faceIndex: Number(entry.faceIndex),
      fingerprintSha256: fingerprint,
      source: entry.source as DocumentFontAsset['source'],
      container: entry.container as DocumentFontAsset['container'],
      outline: entry.outline as DocumentFontAsset['outline'],
      ...(typeof entry.postScriptName === 'string' ? { postScriptName: entry.postScriptName } : {}),
      embedding: {
        level: entry.embedding.level as DocumentFontAsset['embedding']['level'],
        noSubsetting: entry.embedding.noSubsetting,
        bitmapOnly: entry.embedding.bitmapOnly
      },
      familyNames: [...entry.familyNames] as string[],
      styleName: entry.styleName,
      weight: Number(entry.weight),
      stretch: Number(entry.stretch),
      italic: entry.italic,
      byteLength: Number(entry.byteLength),
      ...(Array.isArray(entry.variableAxes) ? { variableAxes: structuredClone(entry.variableAxes) } : {})
    };
  });
  for (const fontAsset of fontAssets) {
    if (await sha256Hex(fontAsset.source) !== fontAsset.fingerprintSha256) {
      throw new Error(`Font bytes for ${fontAsset.fingerprintSha256} failed SHA-256 validation.`);
    }
  }
  const document: ImageDocument = {
    id: source.id as DocumentId,
    name: source.name,
    width: Number(width),
    height: Number(height),
    guides: Array.isArray(source.guides)
      ? source.guides.filter((guide): guide is ImageDocument['guides'][number] => (
          isRecord(guide)
          && typeof guide.id === 'string'
          && (guide.orientation === 'horizontal' || guide.orientation === 'vertical')
          && Number.isFinite(guide.position)
          && (guide.color === undefined || typeof guide.color === 'string')
        )).map((guide) => ({ ...guide }))
      : [],
    resolutionPpi: parseResolutionPpi(source.resolutionPpi),
    layers,
    activeLayerId,
    colorSettings,
    importProvenance,
    photoshopImportReport,
    photoshopDocument,
    assets: { patterns, preservedSources, fonts },
    revision: 0,
    createdAt: now,
    modifiedAt: now
  };
  return {
    document,
    adjustmentStack,
    preview: blob.slice(0, Number(previewLength), 'image/png'),
    assets,
    patternAssets,
    preservedSourceAssets,
    fontAssets
  };
};
