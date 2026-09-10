import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  type LayerStyleSnapshot
} from './completeLayerStyleSnapshot';
import { applyLayerStyleSnapshot } from './layerStyleSnapshotOwner';

export interface SemanticLayerStyleSnapshotDependencies {
  changeDocument(change: (document: ImageDocument) => ImageDocument): boolean;
}

/** Replaces one style owner atomically through the document mutation authority. */
export const executeSemanticLayerStyleSnapshot = (
  command: { readonly layerId: string; readonly snapshot: LayerStyleSnapshot },
  dependencies: SemanticLayerStyleSnapshotDependencies
): { readonly layerId: LayerId; readonly changed: boolean } => {
  let resolvedLayerId: LayerId | null = null;
  const changed = dependencies.changeDocument((document) => {
    const layer = findDocumentLayer(document, command.layerId as LayerId);
    if (!layer || !layerSupportsLayerStyles(layer)) {
      throw new Error('The layer cannot own Layer Styles.');
    }
    if (layer.locks.all) throw new Error('The layer is locked against Layer Style edits.');
    resolvedLayerId = layer.id;
    return applyLayerStyleSnapshot(document, layer.id, command.snapshot);
  });
  if (!resolvedLayerId) throw new Error('The Layer Style owner could not be resolved.');
  return { layerId: resolvedLayerId, changed };
};
