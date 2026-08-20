import type { LightTableCommandId } from './lightTableCommandContract';
import { parseCommittedGestureRequest } from './lightTableCommandValidation';
import { parseSemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';
import { parseSemanticFillCommand } from './semanticFillCommandContract';
import { parseSemanticLayerCommand } from './semanticLayerCommandContract';
import { parseSemanticRasterGradientCommand } from './semanticRasterGradientCommandContract';
import { parseSemanticSelectionCommand } from './semanticSelectionCommandContract';
import { parseSemanticTextCommand } from './semanticTextCommandContract';
import { parseSemanticVectorCommand } from './semanticVectorCommandContract';
import { parseSemanticWarpStrokeCommand } from './semanticWarpCommandContract';

const valid = (parsed: object) => !('message' in parsed);

/** Fail-closed validation for commands observed after a direct UI commit. */
export const observedCommandParametersAreValid = (
  command: LightTableCommandId,
  parameters: unknown
): boolean => {
  switch (command) {
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
    case 'grade.setBasic': return valid(parseSemanticBasicAdjustmentCommand(parameters));
    case 'layer.setTransform': return valid(parseSemanticLayerCommand('set-transform', parameters));
    default: return false;
  }
};
