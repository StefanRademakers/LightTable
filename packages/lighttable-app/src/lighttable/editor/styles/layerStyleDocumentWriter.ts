import type { ImageDocument, LayerId, LayerNode } from '../document/documentTypes';
import { findLayerNode, updateLayerNode } from '../document/layerTree';
import { cloneLayerStyleStack } from './layerStyleDefaults';
import type { LayerStyleStack } from './layerStyleTypes';

/**
 * Low-level replacement after application-layer validation. Production access
 * is restricted by the boundary checker to layerStyleSnapshotOwner.
 */
export const writeLayerStyleStack = (
  document: ImageDocument,
  layerId: LayerId,
  styleStack: LayerStyleStack
) => {
  if (!findLayerNode(document.layers, layerId)) return document;
  const next = cloneLayerStyleStack(styleStack);
  const now = Date.now();
  const layers = updateLayerNode(document.layers, layerId, (layer): LayerNode => {
    return {
      ...layer,
      styleStack: next,
      revision: layer.revision + 1,
      modifiedAt: now
    };
  });
  return {
    ...document,
    layers,
    revision: document.revision + 1,
    modifiedAt: now
  };
};
