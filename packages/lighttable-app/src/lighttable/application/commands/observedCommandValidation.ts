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

const valid = (parsed: object) => !('message' in parsed);

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
    case 'layer.setTransform': return valid(parseSemanticLayerCommand('set-transform', parameters));
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
