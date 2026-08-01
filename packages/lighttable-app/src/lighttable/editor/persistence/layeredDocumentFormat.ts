import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import type {
  DocumentId,
  DocumentAssetId,
  ImageDocument,
  LayerId,
  LayerLocks,
  LayerNode,
  NormalizedImportProvenance,
  PhotoshopImportReport,
  PhotoshopLayerMetadata,
  RasterMask
} from '../document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../document/layerTree';
import { parseLightTableSettings } from '../../lightTableRecipe';
import {
  cloneAdjustmentStack,
  materializeBasicAdjustments,
  type AdjustmentStack,
  type AdjustmentModuleInstance
} from '../../processing/adjustmentStack';
import { CURRENT_PROCESSING_MODULES } from '../../processing/moduleDefinitions';
import type { AffineMatrix } from '../rendering/renderContract';
import { identityAffineMatrix, isFiniteAffineMatrix } from '../rendering/renderContract';
import type { LayerStyleStack } from '../styles/layerStyleTypes';
import { cloneLayerStyleStack } from '../styles/layerStyleDefaults';
import { parseLayerStyleStack } from '../styles/layerStyleValidation';
import {
  cloneVectorPath,
  parseVectorPath,
  type VectorPath
} from '@lighttable/vector-core';

const FOOTER_MAGIC = 'LTBLDOC1';
const FOOTER_SIZE = 12;

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
  photoshop?: PhotoshopLayerMetadata | null;
}

interface RasterLayerManifestEntry extends CommonLayerManifestEntry {
  type: 'raster';
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
  paths: VectorPath[];
  mask: ({ id: string; enabled: boolean; density: number; feather: number; asset: BinaryAssetReference }) | null;
}

type LayerManifestEntry =
  | RasterLayerManifestEntry
  | GroupLayerManifestEntry
  | AdjustmentLayerManifestEntry
  | VectorLayerManifestEntry;

interface LayeredDocumentManifest {
  format: 'lighttable-layered-png';
  version: 1;
  previewLength: number;
  document: {
    id: string;
    name: string;
    width: number;
    height: number;
    activeLayerId: string | null;
    importProvenance: NormalizedImportProvenance | null;
    photoshopImportReport: PhotoshopImportReport | null;
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
      kind: 'photoshop-document';
      name: string;
      mediaType: string;
      byteLength: number;
      asset: BinaryAssetReference;
    }>;
    layers: LayerManifestEntry[];
  };
  adjustmentStack: AdjustmentStack;
}

export interface LayerAssetBlobs {
  layerId: LayerId;
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

export type DocumentAssetBlob = LayerAssetBlobs | PatternAssetBlob | PreservedSourceAssetBlob;

export interface ParsedLayeredDocument {
  document: ImageDocument;
  adjustmentStack: AdjustmentStack;
  preview: Blob;
  assets: LayerAssetBlobs[];
  patternAssets: PatternAssetBlob[];
  preservedSourceAssets: PreservedSourceAssetBlob[];
}

const encodeText = (value: string) => new TextEncoder().encode(value);
const decodeText = (value: ArrayBuffer) => new TextDecoder().decode(value);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBlendMode = (value: unknown): value is BlendMode => BLEND_MODES.some((mode) => mode.id === value);

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
  let offset = preview.size;
  const binaryParts: Blob[] = [];
  const serializeLayer = (layer: LayerNode): LayerManifestEntry => {
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
        paths: layer.paths.map(cloneVectorPath),
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
  const manifest: LayeredDocumentManifest = {
    format: 'lighttable-layered-png',
    version: 1,
    previewLength: preview.size,
    document: {
      id: document.id,
      name: document.name,
      width: document.width,
      height: document.height,
      activeLayerId: document.activeLayerId,
      importProvenance: document.importProvenance,
      photoshopImportReport: document.photoshopImportReport
        ? structuredClone(document.photoshopImportReport)
        : null,
      patterns,
      preservedSources,
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
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value)
    || (
      value.decoder !== 'browser'
      && value.decoder !== 'wasm-vips'
      && value.decoder !== 'ag-psd'
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
    normalizedColorSpace: 'linear-srgb'
  };
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
    return {
      path: entry.path,
      feature: entry.feature as PhotoshopImportReport['compatibility'][number]['feature'],
      support: entry.support as PhotoshopImportReport['compatibility'][number]['support'],
      reason: entry.reason
    };
  });
  return { warnings: [...value.warnings], compatibility };
};

const parseLayerTransform = (value: unknown): AffineMatrix => {
  if (value === null || value === undefined) return identityAffineMatrix();
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
  if (!isRecord(raw) || raw.format !== 'lighttable-layered-png' || raw.version !== 1 || !isRecord(raw.document)) {
    throw new Error('This LightTable document format is not supported.');
  }
  const source = raw.document;
  const width = source.width;
  const height = source.height;
  const previewLength = raw.previewLength;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) <= 0 || Number(height) <= 0 ||
    !Number.isInteger(previewLength) || Number(previewLength) <= 0 || Number(previewLength) > manifestStart || !Array.isArray(source.layers)) {
    throw new Error('The LightTable document dimensions or preview are invalid.');
  }
  const adjustmentStack = parseAdjustmentStack(raw.adjustmentStack);
  const importProvenance = parseImportProvenance(source.importProvenance);
  const photoshopImportReport = parsePhotoshopImportReport(source.photoshopImportReport);
  const now = Date.now();
  const assets: LayerAssetBlobs[] = [];
  const patternAssets: PatternAssetBlob[] = [];
  const preservedSourceAssets: PreservedSourceAssetBlob[] = [];
  const parseLayer = (entry: unknown, path: string): LayerNode => {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.name !== 'string'
      || typeof entry.visible !== 'boolean'
      || typeof entry.opacity !== 'number'
      || typeof entry.fillOpacity !== 'number'
      || typeof entry.clipping !== 'boolean'
      || !isBlendMode(entry.blendMode)
      || (
        entry.type !== 'raster'
        && entry.type !== 'group'
        && entry.type !== 'adjustment'
        && entry.type !== 'vector'
      )
    ) {
      throw new Error(`Layer ${path} in the LightTable document is invalid.`);
    }
    const id = entry.id as LayerId;
    const common = {
      id,
      name: entry.name,
      visible: entry.visible,
      locks: parseLayerLocks(entry.locks),
      opacity: Math.min(1, Math.max(0, entry.opacity)),
      fillOpacity: Math.min(1, Math.max(0, entry.fillOpacity)),
      blendMode: entry.blendMode,
      clipping: entry.clipping,
      styleStack: parseLayerStyleStack(entry.styleStack),
      revision: 0,
      geometryRevision: Number.isInteger(entry.geometryRevision) && Number(entry.geometryRevision) >= 0
        ? Number(entry.geometryRevision)
        : 0,
      createdAt: now,
      modifiedAt: now,
      transform: parseLayerTransform(entry.transform),
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
      if (parsedMask.blob) {
        assets.push({ layerId: id, pixels: new Blob(), mask: parsedMask.blob });
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
      if (parsedMask.blob) {
        assets.push({ layerId: id, pixels: new Blob(), mask: parsedMask.blob });
      }
      return {
        ...common,
        type: 'adjustment',
        adjustmentStack: parseAdjustmentStack(entry.adjustmentStack),
        mask: parsedMask.mask
      };
    }

    if (entry.type === 'vector') {
      if (!Array.isArray(entry.paths)) {
        throw new Error(`Vector layer ${path} in the LightTable document is invalid.`);
      }
      const parsedMask = parseMask();
      if (parsedMask.blob) {
        assets.push({ layerId: id, pixels: new Blob(), mask: parsedMask.blob });
      }
      return {
        ...common,
        type: 'vector',
        paths: entry.paths.map((candidate, index) =>
          parseVectorPath(candidate, `Layer ${path} path ${index + 1}`)),
        mask: parsedMask.mask
      };
    }

    if (!validAssetReference(entry.pixel, Number(previewLength), manifestStart)) {
      throw new Error(`Raster layer ${path} in the LightTable document has invalid pixels.`);
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
      width: Number(width),
      height: Number(height),
      offsetX: 0,
      offsetY: 0,
      pixelSource: { kind: 'runtime-raster', runtimeId: id },
      adjustmentStack: entry.adjustmentStack === null
        ? null
        : parseAdjustmentStack(entry.adjustmentStack),
      dirtyBounds: null,
      mask: parsedMask.mask
    };
  };
  const layers = source.layers.map((entry, index) => parseLayer(entry, `${index + 1}`));
  if (!layers.length || !walkRasterLayers(layers).length) {
    throw new Error('The LightTable document contains no raster layers.');
  }
  const allLayers = walkLayerTree(layers);
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
      || entry.kind !== 'photoshop-document'
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
      kind: 'photoshop-document' as const,
      name: entry.name,
      mediaType: entry.mediaType,
      byteLength: Number(entry.byteLength)
    };
  });
  const document: ImageDocument = {
    id: (typeof source.id === 'string' ? source.id : `document-${crypto.randomUUID()}`) as DocumentId,
    name: typeof source.name === 'string' ? source.name : 'LightTable document',
    width: Number(width),
    height: Number(height),
    layers,
    activeLayerId,
    importProvenance,
    photoshopImportReport,
    assets: { patterns, preservedSources },
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
    preservedSourceAssets
  };
};
