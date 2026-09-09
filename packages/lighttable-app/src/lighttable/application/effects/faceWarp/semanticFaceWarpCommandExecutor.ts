import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import { applyFaceWarpOperation } from '../../../effects/faceWarp/faceWarpOperations';
import {
  setFaceWarpNodeSettings
} from '../../../effects/faceWarp/faceWarpTypes';
import type { SemanticFaceWarpCommand } from '../../commands/semanticFaceWarpCommandContract';
import type {
  DocumentMutationController,
  DocumentMutationDescription
} from '../../documents/useDocumentMutationController';
import { resolveFaceWarpEligibility } from './faceWarpEligibility';

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
  const eligibility = resolveFaceWarpEligibility(document, command.layerId as LayerId);
  if (!eligibility.ok || !eligibility.layer.adjustmentStack) return document;
  const { layer, settings: current } = eligibility;
  const stack = layer.adjustmentStack;
  if (!stack) return document;
  const next = applyFaceWarpOperation(current, command.operation);
  return next === current ? document : setRasterLayerAdjustmentStack(
    document,
    layer.id,
    setFaceWarpNodeSettings(stack, next)
  );
};

export const executeSemanticFaceWarpCommand = (
  command: SemanticFaceWarpCommand,
  dependencies: SemanticFaceWarpCommandDependencies
): { readonly layerId: string; readonly faceId: string; readonly operation: string } | null => {
  const document = dependencies.getDocument();
  if (!document) throw new Error('The target document is unavailable.');
  const layerId = command.layerId as LayerId;
  const eligibility = resolveFaceWarpEligibility(document, layerId);
  if (!eligibility.ok) throw new Error(eligibility.reason);
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
