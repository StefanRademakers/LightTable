import type { Layer, PixelData, Psd } from 'ag-psd';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  RasterMask
} from '../../editor/document/documentTypes';
import { exportLayerStyleStackToPsd } from '../../editor/psd/layerStylePsdExportAdapter';
import { exportTextLayerToPsd } from '../../editor/psd/psdTextExportAdapter';
import { exportVectorLayerToPsd } from '../../editor/psd/psdVectorExportAdapter';
import { walkLayerTree } from '../../editor/document/layerTree';
import { materializeBasicAdjustments } from '../../processing/adjustmentStack';

export interface PsdExportPixelAsset {
  readonly layerId: LayerId;
  readonly pixels?: PixelData;
  readonly mask?: PixelData;
  readonly bounds?: { x: number; y: number; width: number; height: number };
}

export interface PsdExportProjectionResult {
  readonly psd: Psd;
  readonly warnings: readonly string[];
  readonly editableTextLayers: number;
  readonly editableVectorLayers: number;
}

const psdBlendMode = (value: LayerNode['blendMode']) =>
  value.replaceAll('-', ' ') as NonNullable<Layer['blendMode']>;

const numericLayerIdHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
};

const translationOnly = (layer: LayerNode) => Math.abs(layer.transform.a - 1) < 1e-6
  && Math.abs(layer.transform.b) < 1e-6 && Math.abs(layer.transform.c) < 1e-6
  && Math.abs(layer.transform.d - 1) < 1e-6;

const maskData = (
  mask: RasterMask | null,
  pixels: PixelData | undefined,
  document: ImageDocument
): Layer['mask'] => mask && pixels ? {
  top: 0, left: 0, bottom: document.height, right: document.width,
  defaultColor: 255,
  disabled: !mask.enabled,
  positionRelativeToLayer: false,
  fromVectorData: false,
  userMaskDensity: mask.density,
  userMaskFeather: mask.feather,
  imageData: pixels
} : undefined;

/** Pure canonical LightTable -> ag-psd projection. Binary encoding stays in the worker. */
export const projectDocumentToPsd = (
  document: ImageDocument,
  composite: PixelData,
  assets: readonly PsdExportPixelAsset[]
): PsdExportProjectionResult => {
  const byLayer = new Map(assets.map((asset) => [asset.layerId, asset]));
  const warnings: string[] = [];
  let editableTextLayers = 0;
  let editableVectorLayers = 0;
  const allocatedLayerIds = new Set<number>();
  const numericLayerId = (value: string) => {
    let candidate = numericLayerIdHash(value);
    while (allocatedLayerIds.has(candidate)) candidate = (candidate + 1) >>> 0 || 1;
    allocatedLayerIds.add(candidate);
    return candidate;
  };
  const embeddedTextPathLayerIds = new Set(
    walkLayerTree(document.layers).flatMap(({ node }) => {
      if (node.type !== 'text' || node.text.source.kind !== 'flow'
        || node.text.source.layout.mode !== 'path'
        || !node.photoshop?.preserved.text
        || typeof node.photoshop.preserved.text !== 'object'
        || !(node.photoshop.preserved.text as { textPath?: unknown }).textPath) return [];
      return [node.text.source.layout.pathLayerId];
    })
  );

  const projectNodes = (nodes: readonly LayerNode[], path: string): Layer[] =>
    nodes.flatMap((node, index) => embeddedTextPathLayerIds.has(node.id)
      ? [] : [project(node, `${path}[${index}]`)]);

  const project = (node: LayerNode, path: string): Layer => {
    const asset = byLayer.get(node.id);
    if (node.styleStack.effects.some((effect) => (
      effect.kind === 'pattern-overlay'
      || (effect.kind === 'stroke' && effect.fill.type === 'pattern')
    ))) {
      warnings.push(`${path}: pattern-based Layer Styles require PSD pattern-resource export.`);
    }
    const common: Layer = {
      id: numericLayerId(node.id),
      name: node.name,
      hidden: !node.visible,
      opacity: node.opacity,
      fillOpacity: node.fillOpacity,
      blendMode: node.type === 'group' && node.compositing === 'pass-through'
        ? 'pass through' : psdBlendMode(node.blendMode),
      clipping: node.clipping,
      transparencyProtected: node.locks.transparency || node.locks.all,
      protected: {
        transparency: node.locks.transparency || node.locks.all,
        composite: node.locks.pixels || node.locks.all,
        position: node.locks.position || node.locks.all
      },
      timestamp: node.modifiedAt / 1000,
      effects: exportLayerStyleStackToPsd(node.styleStack),
      mask: maskData(node.mask, asset?.mask, document)
    };
    if (node.type === 'group') {
      return { ...common, opened: true, children: projectNodes(node.children, `${path}.children`) };
    }
    if (node.type === 'adjustment') {
      if (node.photoshop?.adjustment && node.revision === 0) {
        common.adjustment = structuredClone(node.photoshop.adjustment) as Layer['adjustment'];
      } else {
        const gradientMap = materializeBasicAdjustments(node.adjustmentStack).gradientMap;
        if (gradientMap?.enabled) {
          common.adjustment = {
            type: 'gradient map',
            gradientType: 'solid',
            reverse: gradientMap.reverse,
            dither: gradientMap.dither,
            colorStops: gradientMap.colorStops.map((stop) => ({
              location: Math.round(stop.position * 4096),
              midpoint: Math.round(stop.midpoint * 100),
              color: {
                r: Math.round(stop.color.r * 255),
                g: Math.round(stop.color.g * 255),
                b: Math.round(stop.color.b * 255)
              }
            })),
            opacityStops: gradientMap.opacityStops.map((stop) => ({
              location: Math.round(stop.position * 4096),
              midpoint: Math.round(stop.midpoint * 100),
              opacity: Math.round(stop.opacity * 100)
            }))
          };
        } else {
          warnings.push(`${path}: this adjustment has no unchanged, exact Photoshop descriptor.`);
        }
      }
      return common;
    }

    if (asset?.pixels) common.imageData = asset.pixels;
    if (node.type === 'raster') {
      if (node.photoshop?.sourceKind === 'smart-object') {
        warnings.push(`${path}: Smart Object source data is not embedded by the PSD writer yet.`);
      }
      if (!translationOnly(node) && !asset?.bounds) {
        warnings.push(`${path}: affine raster transform could not be baked; local pixels were retained.`);
      }
      common.left = Math.round(asset?.bounds?.x ?? node.transform.tx + node.offsetX);
      common.top = Math.round(asset?.bounds?.y ?? node.transform.ty + node.offsetY);
      return common;
    }
    if (node.type === 'text') {
      const text = exportTextLayerToPsd(
        node.text,
        node.transform,
        node.photoshop?.preserved.text
      );
      if (text) {
        common.text = text;
        editableTextLayers += 1;
      } else if (node.photoshop?.preserved.text) {
        common.text = structuredClone(node.photoshop.preserved.text) as Layer['text'];
        warnings.push(`${path}: unsupported native text mode used its preserved Photoshop descriptor.`);
      } else {
        warnings.push(`${path}: text remains raster-backed because its layout cannot yet be represented by ag-psd.`);
      }
      common.left = Math.round(asset?.bounds?.x ?? node.derivedPreview?.transform.tx ?? 0);
      common.top = Math.round(asset?.bounds?.y ?? node.derivedPreview?.transform.ty ?? 0);
      return common;
    }
    const vector = exportVectorLayerToPsd(
      node.elements,
      node.transform,
      node.photoshop?.preserved.vectorFill as Layer['vectorFill'],
      node.photoshop?.preserved.vectorStroke as Layer['vectorStroke']
    );
    if (vector) {
      Object.assign(common, vector);
      common.usingAlignedRendering = node.photoshop?.preserved.usingAlignedRendering ?? true;
      editableVectorLayers += 1;
    } else if (node.photoshop?.preserved.vectorMask) {
      common.vectorMask = structuredClone(node.photoshop.preserved.vectorMask) as Layer['vectorMask'];
      common.vectorFill = structuredClone(node.photoshop.preserved.vectorFill) as Layer['vectorFill'];
      common.vectorStroke = structuredClone(node.photoshop.preserved.vectorStroke) as Layer['vectorStroke'];
      warnings.push(`${path}: mixed vector styles used preserved Photoshop vector descriptors.`);
    } else {
      warnings.push(`${path}: mixed vector styles remain raster-backed in this PSD.`);
    }
    common.left = Math.round(asset?.bounds?.x ?? node.derivedPreview?.transform.tx ?? 0);
    common.top = Math.round(asset?.bounds?.y ?? node.derivedPreview?.transform.ty ?? 0);
    return common;
  };

  return {
    psd: {
      width: document.width,
      height: document.height,
      bitsPerChannel: 8,
      colorMode: 3,
      imageData: composite,
      children: projectNodes(document.layers, 'layers'),
      ...(document.photoshopDocument?.engineData
        ? { engineData: document.photoshopDocument.engineData }
        : {}),
      imageResources: {
        captionDigest: 'LightTable PSD export',
        resolutionInfo: {
          horizontalResolution: document.resolutionPpi,
          horizontalResolutionUnit: 'PPI',
          widthUnit: 'Inches',
          verticalResolution: document.resolutionPpi,
          verticalResolutionUnit: 'PPI',
          heightUnit: 'Inches'
        }
      }
    },
    warnings,
    editableTextLayers,
    editableVectorLayers
  };
};
