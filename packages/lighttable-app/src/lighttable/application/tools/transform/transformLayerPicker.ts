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

export interface TransformLayerAlphaPicker {
  pickTopLayerAtPoint(
    layerIds: readonly LayerId[],
    point: SelectionPoint,
    knownOpaqueLayerIds?: ReadonlySet<LayerId>
  ): Promise<LayerId | null>;
}

export interface TransformLayerPick {
  readonly layerId: LayerId;
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
  const layerId = await picker.pickTopLayerAtPoint(
    drawableLayersTopmostFirst(document.layers),
    point,
    vectorLayerHitsAtDocumentPoint(document, point)
  );
  const layer = layerId ? findDocumentLayer(document, layerId) : null;
  return layer ? { layerId: layer.id } : null;
};
