import type { LightTableCommandId } from './lightTableCommandContract';
import { parseCommittedGestureRequest } from './lightTableCommandValidation';
import { parseSemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';
import { parseSemanticDetailAdjustmentCommand } from './semanticDetailAdjustmentCommandContract';
import { parseSemanticFillCommand } from './semanticFillCommandContract';
import { parseSemanticLayerCommand } from './semanticLayerCommandContract';
import { parseSemanticRasterGradientCommand } from './semanticRasterGradientCommandContract';
import { parseSemanticSelectionCommand } from './semanticSelectionCommandContract';
import { parseSemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand } from './semanticVectorCommandContract';
import { parseSemanticWarpStrokeCommand } from './semanticWarpCommandContract';
import { parseSemanticLayerStyleCommand } from './semanticLayerStyleCommandContract';
import { parseSemanticSubjectSelectionCommand } from './semanticSubjectSelectionCommandContract';
import { parseSemanticAssignProfileCommand } from './semanticDocumentColorCommandContract';
import { parseSemanticAdjustmentSnapshotCommand } from './semanticAdjustmentSnapshotCommandContract';
import { parseSemanticLayerStyleSnapshotCommand } from './semanticLayerStyleSnapshotCommandContract';
import { parseSemanticFilterSnapshotCommand } from './semanticFilterSnapshotCommandContract';
import { parseSemanticAdjustmentCreationCommand } from './semanticAdjustmentCreationCommandContract';
import { parseAtomicCommandBatch } from './atomicCommandBatchContract';

const valid = (parsed: object) => !('message' in parsed);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Fail-closed validation for commands observed after a direct UI commit. */
export const observedCommandParametersAreValid = (
  command: LightTableCommandId,
  parameters: unknown
): boolean => {
  switch (command) {
    case 'document.assignProfile': return valid(parseSemanticAssignProfileCommand(parameters));
    case 'text.replaceRange': return valid(parseSemanticTextCommand('replace', parameters));
    case 'text.format': return valid(parseSemanticTextCommand('format', parameters));
    case 'vector.create': return valid(parseSemanticVectorCommand('create', parameters));
    case 'vector.update': return valid(parseSemanticVectorCommand('update', parameters));
    case 'vector.remove': return valid(parseSemanticVectorCommand('remove', parameters));
    case 'warp.applyStroke': return valid(parseSemanticWarpStrokeCommand(parameters));
    case 'raster.fill': return valid(parseSemanticFillCommand(parameters));
    case 'raster.applyGradient': return valid(parseSemanticRasterGradientCommand(parameters));
    case 'tool.commitGesture': return valid(parseCommittedGestureRequest(parameters));
    case 'selection.applyShape':
    case 'selection.applyMagicWand': return valid(parseSemanticSelectionCommand(parameters));
    case 'selection.selectSubject': return valid(parseSemanticSubjectSelectionCommand(parameters));
    case 'grade.setBasic': return valid(parseSemanticBasicAdjustmentCommand(parameters));
    case 'grade.setDetail': return valid(parseSemanticDetailAdjustmentCommand(parameters));
    case 'adjustment.setSnapshot': return valid(parseSemanticAdjustmentSnapshotCommand(parameters));
    case 'adjustment.create': return valid(parseSemanticAdjustmentCreationCommand(parameters));
    case 'command.batch': return parseAtomicCommandBatch(parameters) !== null;
    case 'layer.style.setSnapshot': return valid(parseSemanticLayerStyleSnapshotCommand(parameters));
    case 'filter.setSnapshot': return valid(parseSemanticFilterSnapshotCommand(parameters));
    case 'layer.setTransform': return valid(parseSemanticLayerCommand('set-transform', parameters));
    case 'layer.setOpacity': return valid(parseSemanticLayerCommand('set-opacity', parameters));
    case 'layer.setVectorAntiAlias': return valid(parseSemanticLayerCommand('set-vector-anti-alias', parameters));
    case 'layer.reorder': return valid(parseSemanticLayerCommand('reorder', parameters));
    case 'layer.setFillOpacity': return record(parameters)
      && typeof parameters.layerId === 'string'
      && typeof parameters.opacity === 'number'
      && Number.isFinite(parameters.opacity)
      && parameters.opacity >= 0 && parameters.opacity <= 1;
    case 'layer.setVisibility': return record(parameters)
      && Array.isArray(parameters.layerIds)
      && parameters.layerIds.length >= 1 && parameters.layerIds.length <= 256
      && parameters.layerIds.every((id) => typeof id === 'string' && id.length > 0)
      && typeof parameters.visible === 'boolean';
    case 'layer.style.update': return valid(parseSemanticLayerStyleCommand('stack-update', parameters));
    case 'layer.effect.add': return valid(parseSemanticLayerStyleCommand('add', parameters));
    case 'layer.effect.update': return valid(parseSemanticLayerStyleCommand('update', parameters));
    case 'layer.effect.remove': return valid(parseSemanticLayerStyleCommand('remove', parameters));
    case 'layer.effect.move': return valid(parseSemanticLayerStyleCommand('move', parameters));
    case 'layer.effect.setEnabled': return valid(parseSemanticLayerStyleCommand('toggle', parameters));
    case 'layer.style.setEnabled': return typeof parameters === 'object' && parameters !== null
      && !Array.isArray(parameters)
      && Object.keys(parameters).length === 2
      && typeof (parameters as Record<string, unknown>).layerId === 'string'
      && typeof (parameters as Record<string, unknown>).enabled === 'boolean';
    default: return false;
  }
};
