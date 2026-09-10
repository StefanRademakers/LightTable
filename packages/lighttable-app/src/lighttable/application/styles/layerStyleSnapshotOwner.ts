import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer, updateLayerNode } from '../../editor/document/layerTree';
import { writeLayerStyleStack } from '../../editor/styles/layerStyleDocumentWriter';
import type { LayerStyleStack } from '../../editor/styles/layerStyleTypes';
import {
  layerStyleSnapshot,
  layerStyleSnapshotsEqual,
  materializeLayerStyleSnapshot,
  parseCompleteLayerStyleSnapshot,
  type LayerStyleSnapshot
} from './completeLayerStyleSnapshot';

export const resolveLayerStyleOwner = (document: ImageDocument, layerId: LayerId) => {
  const layer = findDocumentLayer(document, layerId);
  return layer && layerSupportsLayerStyles(layer) && !layer.locks.all ? layer : null;
};

/** Validates and replaces one canonical style owner with one revision step. */
export const applyLayerStyleSnapshot = (
  document: ImageDocument,
  layerId: LayerId,
  snapshot: LayerStyleSnapshot
): ImageDocument => {
  const owner = resolveLayerStyleOwner(document, layerId);
  if (!owner) throw new Error('The Layer Style owner does not exist or is locked.');
  const validated = parseCompleteLayerStyleSnapshot(snapshot);
  if (!validated) throw new Error('The Layer Style snapshot is outside its canonical bounds.');
  if (layerStyleSnapshotsEqual(layerStyleSnapshot(owner.styleStack), validated)) return document;
  return writeLayerStyleStack(document, layerId, materializeLayerStyleSnapshot(
    validated, owner.styleStack.revision + 1
  ));
};

/**
 * Builds a disposable render projection without cloning/stringifying the full
 * style stack. The UI draft is immutable and can be shared until the frame is
 * superseded; canonical publication always goes through applyLayerStyleSnapshot.
 */
export const projectLayerStylePreview = (
  before: ImageDocument,
  layerId: LayerId,
  draft: LayerStyleStack,
  previewGeneration: number
): ImageDocument => {
  const owner = resolveLayerStyleOwner(before, layerId);
  if (!owner || previewGeneration < 1) {
    throw new Error('A Layer Style preview requires a live owner and positive generation.');
  }
  const projectedStack = { ...draft, revision: owner.styleStack.revision + previewGeneration };
  const layers = updateLayerNode(before.layers, layerId, (layer) => ({
    ...layer,
    styleStack: projectedStack,
    revision: owner.revision + previewGeneration,
    modifiedAt: before.modifiedAt
  }));
  return { ...before, layers, revision: before.revision + previewGeneration };
};
