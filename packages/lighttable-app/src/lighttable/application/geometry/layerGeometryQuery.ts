import type { Vec2 } from '@lighttable/vector-core';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  Rect
} from '../../editor/document/documentTypes';
import { layerDerivedPreviewIsCurrent } from '../../editor/document/documentTypes';
import {
  buildSceneTransformIndex,
  type SceneTransformIndex
} from '../../editor/document/sceneTransformGraph';
import {
  identityAffineMatrix,
  multiplyMatrices,
  transformedBounds
} from '../../editor/geometry/affine';
import { layerStyleExpansion } from '../../editor/styles/layerStyleRenderPlan';
import { vectorLayerLocalPaintBounds } from '../vectors/vectorSceneQueries';

export type LayerBoundsSource =
  | 'raster-source'
  | 'vector-paint'
  | 'text-frame'
  | 'derived-preview'
  | 'photoshop-metadata'
  | 'group-union'
  | 'unavailable';

export interface LayerGeometryBounds {
  readonly layerId: LayerId;
  /** Authored/paint extent in document coordinates; not always hit-test safe. */
  readonly documentBounds: Rect | null;
  /**
   * Conservative rejection-safe visual extent after effects. A point inside
   * still requires exact testing; null means the current semantic projection
   * cannot safely reject any point for this layer.
   */
  readonly visualBounds: Rect | null;
  readonly source: LayerBoundsSource;
}

export interface LayerGeometryIndex {
  readonly transforms: SceneTransformIndex;
  readonly byLayerId: ReadonlyMap<LayerId, LayerGeometryBounds>;
}

const cache = new WeakMap<object, LayerGeometryIndex>();

const positiveRect = (rect: Rect | null | undefined): rect is Rect => Boolean(
  rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
  && rect.width > 0 && rect.height > 0
);

const unionRects = (left: Rect | null, right: Rect | null): Rect | null => {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
};

const expanded = (bounds: Rect | null, amount: number): Rect | null => bounds ? ({
  x: bounds.x - amount,
  y: bounds.y - amount,
  width: bounds.width + amount * 2,
  height: bounds.height + amount * 2
}) : null;

const leafBounds = (
  transforms: SceneTransformIndex,
  layer: Exclude<LayerNode, { type: 'group' | 'adjustment' }>
): Omit<LayerGeometryBounds, 'layerId' | 'visualBounds'> & {
  readonly visualBoundsSafe?: boolean;
} => {
  const resolved = transforms.get(layer.id);
  if (!resolved) return { documentBounds: null, source: 'unavailable' };

  if (layer.type === 'raster') return {
    documentBounds: transformedBounds(resolved.localToDocument, {
      x: 0, y: 0, width: layer.width, height: layer.height
    }),
    source: 'raster-source'
  };

  if (layer.type === 'vector') {
    const local = vectorLayerLocalPaintBounds(layer);
    return {
      documentBounds: positiveRect(local)
        ? transformedBounds(resolved.localToDocument, local)
        : null,
      source: 'vector-paint'
    };
  }

  if (layerDerivedPreviewIsCurrent(layer) && layer.derivedPreview) {
    const parentToDocument = resolved.parentId
      ? transforms.get(resolved.parentId)?.localToDocument ?? identityAffineMatrix()
      : identityAffineMatrix();
    return {
      documentBounds: transformedBounds(
        multiplyMatrices(parentToDocument, layer.derivedPreview.transform),
        { x: 0, y: 0, width: layer.derivedPreview.width, height: layer.derivedPreview.height }
      ),
      source: 'derived-preview'
    };
  }

  const source = layer.text.source;
  if (source.kind === 'flow' && source.layout.mode === 'paragraph') return {
    documentBounds: transformedBounds(resolved.localToDocument, source.layout.frame),
    source: 'text-frame',
    // Overflowing paragraph ink is not bounded by its authored frame. Keep
    // the frame useful for layout/snapping, but never use it to reject hits.
    visualBoundsSafe: source.layout.overflow !== 'visible'
  };
  if (positiveRect(layer.photoshop?.bounds)) return {
    // Imported Photoshop bounds are already document-space metadata.
    documentBounds: { ...layer.photoshop.bounds },
    source: 'photoshop-metadata'
  };
  return { documentBounds: null, source: 'unavailable' };
};

/**
 * Builds the shared cheap geometry projection for one immutable document snapshot.
 *
 * Canonical edits replace the document snapshot, so a WeakMap gives retained,
 * revision-correct geometry without introducing invalidation state. Consumers
 * must use these rectangles only to reject impossible hits; exact vector,
 * texture-alpha, mask and clipping tests still decide positive hits.
 */
export const buildLayerGeometryIndex = (
  document: Pick<ImageDocument, 'layers'>
): LayerGeometryIndex => {
  const cached = cache.get(document as object);
  if (cached) return cached;

  const transforms = buildSceneTransformIndex(document);
  const byLayerId = new Map<LayerId, LayerGeometryBounds>();
  const visit = (layer: LayerNode): LayerGeometryBounds => {
    if (layer.type === 'adjustment') {
      const result = {
        layerId: layer.id,
        documentBounds: null,
        visualBounds: null,
        source: 'unavailable' as const
      };
      byLayerId.set(layer.id, result);
      return result;
    }
    if (layer.type === 'group') {
      const children = layer.children.map(visit);
      const documentBounds = children.reduce<Rect | null>(
        (bounds, child) => unionRects(bounds, child.documentBounds), null
      );
      const childVisualBounds = children.reduce<Rect | null>(
        (bounds, child) => unionRects(bounds, child.visualBounds), null
      );
      const visualBounds = children.some((child) => child.visualBounds === null)
        ? null
        : expanded(childVisualBounds, layerStyleExpansion(layer.styleStack));
      const result = {
        layerId: layer.id,
        documentBounds,
        visualBounds,
        source: documentBounds ? 'group-union' as const : 'unavailable' as const
      };
      byLayerId.set(layer.id, result);
      return result;
    }
    const leaf = leafBounds(transforms, layer);
    const { visualBoundsSafe = true, ...projection } = leaf;
    const result = {
      layerId: layer.id,
      ...projection,
      visualBounds: visualBoundsSafe
        ? expanded(leaf.documentBounds, layerStyleExpansion(layer.styleStack))
        : null
    };
    byLayerId.set(layer.id, result);
    return result;
  };
  document.layers.forEach(visit);
  const result = { transforms, byLayerId };
  cache.set(document as object, result);
  return result;
};

export const layerGeometryBounds = (
  document: Pick<ImageDocument, 'layers'>,
  layerId: LayerId
): LayerGeometryBounds | null => buildLayerGeometryIndex(document).byLayerId.get(layerId) ?? null;

export const pointInBounds = (
  point: Vec2,
  bounds: Rect | null | undefined,
  padding = 0
): boolean => Boolean(bounds
  && point.x >= bounds.x - padding
  && point.y >= bounds.y - padding
  && point.x <= bounds.x + bounds.width + padding
  && point.y <= bounds.y + bounds.height + padding);
