import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { layerIsLocked } from '../../../editor/document/documentTypes';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { applyFaceWarpOperation } from '../../../effects/faceWarp/faceWarpOperations';
import {
  findFaceWarpModuleInstance,
  readFaceWarpNodeSettings,
  setFaceWarpNodeSettings
} from '../../../effects/faceWarp/faceWarpTypes';
import type { SemanticFaceWarpCommand } from '../../commands/semanticFaceWarpCommandContract';
import type {
  DocumentMutationController,
  DocumentMutationDescription
} from '../../documents/useDocumentMutationController';

export interface SemanticFaceWarpCommandDependencies {
  getDocument(): ImageDocument | null;
  changeDocument: DocumentMutationController['change'];
}

const faceWarpMutationDescription = (
  layerId: LayerId
): DocumentMutationDescription => ({
  label: 'Face Warp',
  type: 'face-warp.operation',
  layerIds: [layerId]
});

/** One canonical document mutation used by both UI and automation transports. */
export const applySemanticFaceWarpCommandToDocument = (
  document: ImageDocument,
  command: SemanticFaceWarpCommand
): ImageDocument => {
  const layer = findRasterLayer(document, command.layerId as LayerId);
  if (!layer || layerIsLocked(layer) || !layer.adjustmentStack) return document;
  const instance = findFaceWarpModuleInstance(layer.adjustmentStack);
  if (!instance) return document;
  const current = readFaceWarpNodeSettings(instance);
  const next = applyFaceWarpOperation(current, command.operation);
  return next === current ? document : setRasterLayerAdjustmentStack(
    document,
    layer.id,
    setFaceWarpNodeSettings(layer.adjustmentStack, next)
  );
};

export const executeSemanticFaceWarpCommand = (
  command: SemanticFaceWarpCommand,
  dependencies: SemanticFaceWarpCommandDependencies
): { readonly layerId: string; readonly faceId: string; readonly operation: string } | null => {
  if (!dependencies.getDocument()) throw new Error('The target document is unavailable.');
  const layerId = command.layerId as LayerId;
  const result = {
    layerId: command.layerId,
    faceId: command.operation.faceId,
    operation: command.operation.kind
  };
  const changed = dependencies.changeDocument(
    (document) => applySemanticFaceWarpCommandToDocument(document, command),
    true,
    faceWarpMutationDescription(layerId)
  );
  return changed ? result : null;
};
