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
import {
  exportAdjustmentStackToPsd,
  exportGradeStackModulesToPsd
} from '../../editor/psd/psdAdjustmentExportAdapter';
import { walkLayerTree } from '../../editor/document/layerTree';
import type { PsdExportCompatibilityFinding, PsdExportIntent } from './psdExportProtocol';

export interface PsdExportPixelAsset {
  readonly layerId: LayerId;
  readonly pixels?: PixelData;
  readonly mask?: PixelData;
  readonly bounds?: { x: number; y: number; width: number; height: number };
}

export interface PsdExportLutAsset {
  readonly lutId: string;
  readonly data: Uint8Array;
}

export interface PsdExportProjectionResult {
  readonly psd: Psd;
  readonly findings: readonly PsdExportCompatibilityFinding[];
  readonly warnings: readonly string[];
  readonly blockingWarnings: readonly string[];
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
  assets: readonly PsdExportPixelAsset[],
  lutAssets: readonly PsdExportLutAsset[] = [],
  intent: PsdExportIntent = 'editable'
): PsdExportProjectionResult => {
  const imageResources: NonNullable<Psd['imageResources']> = {
    captionDigest: 'LightTable PSD export',
    resolutionInfo: {
      horizontalResolution: document.resolutionPpi,
      horizontalResolutionUnit: 'PPI',
      widthUnit: 'Inches',
      verticalResolution: document.resolutionPpi,
      verticalResolutionUnit: 'PPI',
      heightUnit: 'Inches'
    }
  };
  if (intent === 'maximum-appearance') {
    return {
      psd: {
        width: document.width,
        height: document.height,
        bitsPerChannel: 8,
        colorMode: 3,
        imageData: composite,
        children: [{
          id: numericLayerIdHash('lighttable:maximum-appearance'),
          name: 'LightTable Appearance',
          opacity: 1,
          fillOpacity: 1,
          blendMode: 'normal',
          left: 0,
          top: 0,
          imageData: composite
        }],
        imageResources
      },
      findings: [],
      warnings: [],
      blockingWarnings: [],
      editableTextLayers: 0,
      editableVectorLayers: 0
    };
  }
  const byLayer = new Map(assets.map((asset) => [asset.layerId, asset]));
  const byLut = new Map(lutAssets.map((asset) => [asset.lutId, asset.data]));
  const resolveColorLookup = (assetId: string) => {
    const metadata = document.assets.colorLookups.find(({ id }) => id === assetId);
    const data = byLut.get(assetId);
    return metadata && data ? { name: metadata.name, data } : null;
  };
  const findings: PsdExportCompatibilityFinding[] = [];
  const report = (
    severity: PsdExportCompatibilityFinding['severity'],
    code: PsdExportCompatibilityFinding['code'],
    path: string,
    message: string
  ) => findings.push({ severity, code, path, message });
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
    nodes.flatMap((node, index) => {
      if (embeddedTextPathLayerIds.has(node.id)) return [];
      const nodePath = `${path}[${index}]`;
      const base = project(node, nodePath);
      if (node.type !== 'raster') return [base];
      const attached = (node.attachedAdjustments ?? []).flatMap((adjustment, adjustmentIndex) => {
        const descriptor = exportAdjustmentStackToPsd(
          adjustment.adjustmentKind,
          adjustment.adjustmentStack,
          resolveColorLookup
        );
        if (!descriptor) {
          report(
            'degraded-editability',
            'attached-adjustment-baked',
            `${nodePath}.attachedAdjustments[${adjustmentIndex}]`,
            `${adjustment.name} was baked into the owner layer pixels because it has no exact Photoshop descriptor.`
          );
          return [];
        }
        return [{
          id: numericLayerId(`${node.id}:attached:${adjustment.id}`),
          name: adjustment.name,
          hidden: !adjustment.enabled,
          opacity: 1,
          fillOpacity: 1,
          blendMode: 'normal' as const,
          clipping: true,
          adjustment: descriptor,
          timestamp: node.modifiedAt / 1000
        } satisfies Layer];
      });
      return [base, ...attached];
    });

  const project = (node: LayerNode, path: string): Layer => {
    const asset = byLayer.get(node.id);
    if (node.styleStack.effects.some((effect) => (
      effect.kind === 'pattern-overlay'
      || (effect.kind === 'stroke' && effect.fill.type === 'pattern')
    ))) {
      report('blocking', 'layer-style-pattern-resource', path,
        'pattern-based Layer Styles require PSD pattern-resource export.');
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
      if (node.adjustmentKind === 'grade') {
        const maskIsPristineWhite = Boolean(node.mask
          && node.mask.enabled
          && node.mask.revision === 0
          && node.mask.pixelRevision === 0
          && node.mask.density === 1
          && node.mask.feather === 0);
        const maskAvailable = !node.mask || maskIsPristineWhite || Boolean(asset?.mask);
        const usesSafePassThroughBoundary = maskAvailable
          && !node.clipping
          && (!node.styleStack.enabled
            || !node.styleStack.effects.some((effect) => effect.enabled));
        const modules = usesSafePassThroughBoundary
          ? exportGradeStackModulesToPsd(node.adjustmentStack, resolveColorLookup)
          : null;
        if (modules) {
          return {
            ...common,
            // A normal empty folder isolates its children. Pass-through lets
            // the adjustment children affect the same lower sibling composite
            // as the ordinary LightTable processing layer.
            blendMode: 'pass through',
            opacity: 1,
            fillOpacity: 1,
            clipping: false,
            // Boundary semantics belong to the one projected adjustment
            // child. Keeping the wrapper neutral avoids group isolation.
            mask: undefined,
            opened: false,
            children: modules.map((module, moduleIndex) => ({
              id: numericLayerId(`${node.id}:grade:${module.moduleType}:${moduleIndex}`),
              name: module.name,
              hidden: false,
              opacity: node.opacity,
              fillOpacity: 1,
              blendMode: psdBlendMode(node.blendMode),
              clipping: false,
              mask: maskIsPristineWhite ? undefined : common.mask,
              adjustment: module.adjustment,
              timestamp: node.modifiedAt / 1000
            }))
          };
        }
        report('blocking', 'grade-unprojectable', path,
          'this Grade Layer contains processing or layer settings without a proven editable Photoshop projection.');
        return common;
      }
      if (node.photoshop?.adjustment && node.revision === 0) {
        common.adjustment = structuredClone(node.photoshop.adjustment) as Layer['adjustment'];
      } else {
        const adjustment = exportAdjustmentStackToPsd(
          node.adjustmentKind,
          node.adjustmentStack,
          resolveColorLookup
        );
        if (adjustment) common.adjustment = adjustment;
        else {
          report('blocking', 'native-adjustment-unprojectable', path,
            'this adjustment has no unchanged, exact Photoshop descriptor.');
        }
      }
      return common;
    }

    if (asset?.pixels) common.imageData = asset.pixels;
    if (node.type === 'raster') {
      if (node.adjustmentStack?.modules.some((module) => module.type === 'lt.face-warp')) {
        report('degraded-editability', 'face-warp-baked', path,
          'LightTable Face Warp was baked into the PSD layer pixels; editable Face Warp semantics remain in the LightTable document.');
      }
      if (node.photoshop?.sourceKind === 'smart-object') {
        report('degraded-editability', 'smart-object-source-missing', path,
          'Smart Object source data is not embedded by the PSD writer yet.');
      }
      if (!translationOnly(node) && !asset?.bounds) {
        report('blocking', 'affine-raster-unbaked', path,
          'affine raster transform could not be baked; local pixels were retained.');
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
        report('degraded-editability', 'text-preserved-descriptor', path,
          'unsupported native text mode used its preserved Photoshop descriptor.');
      } else {
        report('degraded-editability', 'text-raster-backed', path,
          'text remains raster-backed because its layout cannot yet be represented by ag-psd.');
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
      report('degraded-editability', 'vector-preserved-descriptor', path,
        'mixed vector styles used preserved Photoshop vector descriptors.');
    } else {
      report('degraded-editability', 'vector-raster-backed', path,
        'mixed vector styles remain raster-backed in this PSD.');
    }
    common.left = Math.round(asset?.bounds?.x ?? node.derivedPreview?.transform.tx ?? 0);
    common.top = Math.round(asset?.bounds?.y ?? node.derivedPreview?.transform.ty ?? 0);
    return common;
  };

  const warningText = (finding: PsdExportCompatibilityFinding) =>
    `${finding.path}: ${finding.message}`;
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
      imageResources
    },
    findings,
    warnings: findings.map(warningText),
    blockingWarnings: findings.filter(({ severity }) => severity === 'blocking').map(warningText),
    editableTextLayers,
    editableVectorLayers
  };
};
