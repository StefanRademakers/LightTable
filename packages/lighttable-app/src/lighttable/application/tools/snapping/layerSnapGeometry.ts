import { vectorLayerLocalPaintBounds } from '../../vectors/vectorSceneQueries';
import type { ImageDocument, LayerId, LayerNode, Rect } from '../../../editor/document/documentTypes';
import { walkLayerTree } from '../../../editor/document/layerTree';
import {
  buildSceneTransformIndex,
  type SceneTransformIndex
} from '../../../editor/document/sceneTransformGraph';
import { identityAffineMatrix, multiplyMatrices, transformedBounds } from '../../../editor/geometry/affine';
import { snapFeaturesForCanvas, snapFeaturesForRect, snapLineFeature, type SnapFeature, type SnapRect } from './snapEngine';

const positiveRect = (rect: Rect | null | undefined): rect is Rect => Boolean(
  rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && rect.width > 0 && rect.height > 0
);

const textLocalBounds = (layer: Extract<LayerNode, { type: 'text' }>): Rect | null => {
  const source = layer.text.source;
  if (source.kind === 'flow' && source.layout.mode === 'paragraph') return source.layout.frame;
  return null;
};

/**
 * Cheap retained geometry for pointer-time snapping.
 *
 * Raster sources use their retained tight source rectangle, vectors use exact
 * semantic paint bounds, and text prefers an authored frame/current preview.
 * No GPU texture scan or readback is performed here.
 */
const layerDocumentSnapBoundsFromIndex = (
  transforms: SceneTransformIndex,
  layer: LayerNode
): Rect | null => {
  const resolved = transforms.get(layer.id);
  if (!resolved || layer.type === 'group' || layer.type === 'adjustment') return null;

  if (layer.type === 'raster') {
    return transformedBounds(resolved.localToDocument, {
      x: 0, y: 0, width: layer.width, height: layer.height
    });
  }
  if (layer.type === 'vector') {
    const local = vectorLayerLocalPaintBounds(layer);
    return positiveRect(local) ? transformedBounds(resolved.localToDocument, local) : null;
  }
  if (layer.derivedPreview) {
    const parent = resolved.parentId
      ? transforms.get(resolved.parentId)?.localToDocument ?? identityAffineMatrix()
      : identityAffineMatrix();
    return transformedBounds(multiplyMatrices(parent, layer.derivedPreview.transform), {
      x: 0,
      y: 0,
      width: layer.derivedPreview.width,
      height: layer.derivedPreview.height
    });
  }
  const local = textLocalBounds(layer);
  if (positiveRect(local)) return transformedBounds(resolved.localToDocument, local);
  // Imported point/positioned text may not have a realized layout yet. PSD
  // bounds are already document-space authoring metadata and are preferable
  // to making the layer unsnappable while its layout cache warms.
  return positiveRect(layer.photoshop?.bounds) ? { ...layer.photoshop.bounds } : null;
};

export const layerDocumentSnapBounds = (
  document: Pick<ImageDocument, 'layers'>,
  layer: LayerNode
): Rect | null => layerDocumentSnapBoundsFromIndex(buildSceneTransformIndex(document), layer);

export interface LayerSnapTargetOptions {
  excludedLayerIds?: ReadonlySet<LayerId>;
  includeCanvas?: boolean;
  includeCanvasCenter?: boolean;
  includeLayers?: boolean;
  includeGuides?: boolean;
  includeGrid?: boolean;
  gridSpacing?: number;
  gridOriginX?: number;
  gridOriginY?: number;
  movingBounds?: SnapRect;
}

export const buildLayerSnapTargets = (
  document: ImageDocument,
  options: LayerSnapTargetOptions = {}
): SnapFeature[] => {
  const excluded = options.excludedLayerIds ?? new Set<LayerId>();
  const entries = walkLayerTree(document.layers);
  const byId = new Map(entries.map((entry) => [entry.node.id, entry]));
  // Resolve the scene graph once for the complete target build. The old path
  // rebuilt this O(n) index once per layer, turning every pointer-time snap
  // refresh into O(n²) work on imported SVGs with many logical objects.
  const transforms = buildSceneTransformIndex(document);
  const effectiveVisibility = new Map<LayerId, boolean>();
  for (const { node, parentId } of entries) {
    effectiveVisibility.set(
      node.id,
      node.visible && (parentId ? effectiveVisibility.get(parentId) !== false : true)
    );
  }
  const parentVisible = (layerId: LayerId): boolean => {
    const parentId = byId.get(layerId)?.parentId ?? null;
    return parentId ? effectiveVisibility.get(parentId) !== false : true;
  };
  const targets: SnapFeature[] = options.includeCanvas === false
    ? []
    : snapFeaturesForCanvas(document.width, document.height, options.includeCanvasCenter ?? false);
  if (options.includeGuides !== false) {
    document.guides.forEach((guide) => targets.push(snapLineFeature(
      guide.orientation === 'vertical' ? 'x' : 'y',
      guide.position,
      'guide',
      guide.id
    )));
  }
  if (options.includeGrid && options.movingBounds) {
    const spacing = Math.max(1e-6, options.gridSpacing ?? 100);
    const origins = { x: options.gridOriginX ?? 0, y: options.gridOriginY ?? 0 };
    (['x', 'y'] as const).forEach((axis) => {
      const start = axis === 'x' ? options.movingBounds!.x : options.movingBounds!.y;
      const length = axis === 'x' ? options.movingBounds!.width : options.movingBounds!.height;
      const origin = origins[axis];
      [start, start + length / 2, start + length].forEach((position) => {
        const line = origin + Math.round((position - origin) / spacing) * spacing;
        targets.push(snapLineFeature(axis, line, 'grid', `${axis}:${line}`));
      });
    });
  }
  if (options.includeLayers !== false) {
    for (const { node } of entries) {
      if (excluded.has(node.id) || !node.visible || !parentVisible(node.id)) continue;
      const bounds = layerDocumentSnapBoundsFromIndex(transforms, node);
      if (!positiveRect(bounds)) continue;
      targets.push(...snapFeaturesForRect(bounds, 'layer', node.id));
    }
  }
  return targets;
};
