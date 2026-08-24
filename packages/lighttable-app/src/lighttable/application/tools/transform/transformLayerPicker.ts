import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode
} from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { SelectionPoint } from '../../../editor/selection/selectionTypes';
import { vectorLayerHitsAtDocumentPoint } from '../../vectors/vectorSceneQueries';
import { layerStyleStackIsActive } from '../../../editor/styles/layerStyleDefaults';
import { buildLayerGeometryIndex, pointInBounds } from '../../geometry/layerGeometryQuery';
import type { SceneTransformIndex } from '../../../editor/document/sceneTransformGraph';

export interface TransformLayerAlphaPicker {
  pickTopLayerAtPoint(
    layerIds: readonly LayerId[],
    point: SelectionPoint,
    knownOpaqueLayerIds?: ReadonlySet<LayerId>,
    sceneTransforms?: SceneTransformIndex
  ): Promise<LayerId | null>;
}

export interface TransformLayerPick {
  readonly layerId: LayerId;
}

export interface CurrentTransformLayerPickRequest {
  readonly initialDocument: ImageDocument;
  readonly point: SelectionPoint;
  readonly picker: TransformLayerAlphaPicker;
  readonly isCurrent: () => boolean;
  readonly getCurrentDocument: () => ImageDocument | null;
}

const drawableLayersTopmostFirst = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true,
  ancestorsMovable = true
): LayerId[] => [...nodes].reverse().flatMap((node) => {
  const visible = ancestorsVisible && node.visible && node.opacity > 0;
  const movable = ancestorsMovable && !layerIsLocked(node, 'position');
  if (!visible || !movable) return [];
  if (node.type === 'group') {
    return drawableLayersTopmostFirst(node.children, visible, movable);
  }
  return node.type === 'adjustment'
    || (node.fillOpacity <= 0 && !layerStyleStackIsActive(node.styleStack))
    ? [] : [node.id];
});

/**
 * Picks from the actual visual stack. The GPU answers only the alpha question;
 * ordering and lock semantics remain deterministic application policy.
 */
export const pickTransformLayer = async (
  document: ImageDocument,
  point: SelectionPoint,
  picker: TransformLayerAlphaPicker
): Promise<TransformLayerPick | null> => {
  const geometry = buildLayerGeometryIndex(document);
  const candidates = drawableLayersTopmostFirst(document.layers).filter((layerId) => {
    const bounds = geometry.byLayerId.get(layerId)?.visualBounds;
    // Unknown geometry stays eligible. Point/path text can be awaiting its
    // retained layout, and a broad phase must never create false negatives.
    return !bounds || pointInBounds(point, bounds);
  });
  const candidateIds = new Set(candidates);
  const layerId = await picker.pickTopLayerAtPoint(
    candidates,
    point,
    vectorLayerHitsAtDocumentPoint(document, point, 0.5, candidateIds, geometry.transforms),
    geometry.transforms
  );
  const layer = layerId ? findDocumentLayer(document, layerId) : null;
  return layer ? { layerId: layer.id } : null;
};

/**
 * Resolves one user click against a stable immutable document snapshot.
 *
 * GPU alpha readback is asynchronous. If an edit publishes a replacement
 * snapshot while it is in flight, repeat the complete topmost-first query on
 * that latest snapshot instead of applying or silently dropping a stale hit.
 */
export const pickCurrentTransformLayer = async (
  request: CurrentTransformLayerPickRequest
): Promise<TransformLayerPick | null> => {
  let sourceDocument = request.initialDocument;
  while (request.isCurrent()) {
    const pick = await pickTransformLayer(sourceDocument, request.point, request.picker);
    if (!request.isCurrent()) return null;
    const currentDocument = request.getCurrentDocument();
    if (!currentDocument || currentDocument.id !== sourceDocument.id) return null;
    if (currentDocument === sourceDocument) return pick;
    sourceDocument = currentDocument;
  }
  return null;
};
