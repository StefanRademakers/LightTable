import {
  ensureRasterLayerLocalProcessing,
  removeRasterLayerAttachedAdjustment,
  removeRasterLayerLocalProcessing,
  setGradeOwnerGroupEnabled,
  setRasterLayerAttachedAdjustmentEnabled,
  setRasterLayerLocalProcessingEnabled
} from '../../editor/document/documentCommands';
import { attachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  SemanticProcessingStructureCommand,
  SemanticProcessingStructureResult
} from '../commands/semanticProcessingStructureCommandContract';

export interface SemanticProcessingStructureDependencies {
  changeDocument(change: (document: ImageDocument) => ImageDocument): boolean;
}

export const executeSemanticProcessingStructure = (
  command: SemanticProcessingStructureCommand,
  dependencies: SemanticProcessingStructureDependencies
): SemanticProcessingStructureResult => {
  const changed = dependencies.changeDocument((document) => {
    if (command.operation === 'set-enabled') {
      return command.target.kind === 'local'
        ? setRasterLayerLocalProcessingEnabled(
            ensureRasterLayerLocalProcessing(document, command.target.layerId, command.target.owner),
            command.target.layerId,
            command.enabled,
            command.target.owner
          )
        : setRasterLayerAttachedAdjustmentEnabled(
            document, command.target.layerId, command.target.adjustmentId, command.enabled
          );
    }
    if (command.operation === 'remove') {
      return command.target.kind === 'local'
        ? removeRasterLayerLocalProcessing(document, command.target.layerId, command.target.owner)
        : removeRasterLayerAttachedAdjustment(
            document, command.target.layerId, command.target.adjustmentId
          );
    }
    const ownerId = command.target.kind === 'attached'
      ? attachedAdjustmentOwnerId(command.target.layerId, command.target.adjustmentId)
      : command.target.layerId;
    return setGradeOwnerGroupEnabled(document, ownerId, command.group, command.enabled);
  });
  return { ...command, changed } as SemanticProcessingStructureResult;
};
