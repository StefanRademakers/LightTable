import { layerIsLocked, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  parseSemanticAdjustmentCreationCommand,
  type SemanticAdjustmentCreationCommand
} from './semanticAdjustmentCreationCommandContract';
import {
  parseSemanticFixedTransformCommand,
  type SemanticFixedTransformCommand
} from './semanticFixedTransformCommandContract';
import { parseSemanticRasterInvertCommand,
  type SemanticRasterInvertCommand } from './semanticRasterInvertCommandContract';

type ContextualEditError = {
  readonly ok: false;
  readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed';
  readonly message: string;
};
type ContextualEditResult = { readonly ok: true; readonly value: unknown } | ContextualEditError;
type Executor<T> = ((command: T) => unknown | Promise<unknown>) | undefined;

const changedResult = async <T>(command: T, execute: Executor<T>, unavailable: string,
  noValue: Pick<ContextualEditError, 'code' | 'message'>,
  beforeRevision: number, revision: () => number | undefined): Promise<ContextualEditResult> => {
  if (!execute) return { ok: false, code: 'command-unavailable', message: unavailable };
  const value = await execute(command);
  if (!value) return { ok: false, ...noValue };
  if (revision() === beforeRevision) {
    return { ok: false, code: 'execution-failed', message: 'The edit did not change the document.' };
  }
  return { ok: true, value };
};

export const dispatchSemanticFixedTransform = async (value: unknown, document: ImageDocument,
  execute: Executor<SemanticFixedTransformCommand>, revision: () => number | undefined
): Promise<ContextualEditResult> => {
  const command = parseSemanticFixedTransformCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  return changedResult(command, execute, 'Fixed transform commands are unavailable in this host.',
    { code: 'command-unavailable', message: 'There is no editable transform target.' },
    document.revision, revision);
};

export const dispatchSemanticAdjustmentCreation = async (value: unknown, document: ImageDocument,
  execute: Executor<SemanticAdjustmentCreationCommand>, revision: () => number | undefined
): Promise<ContextualEditResult> => {
  const command = parseSemanticAdjustmentCreationCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (command.placement === 'adjustment-layer') {
    if (command.aboveLayerId && !findDocumentLayer(document, command.aboveLayerId)) {
      return { ok: false, code: 'command-unavailable', message: 'The adjustment-layer anchor does not exist.' };
    }
  } else {
    const layer = findDocumentLayer(document, command.layerId);
    if (layer?.type !== 'raster' || layerIsLocked(layer, 'pixels')) {
      return { ok: false, code: 'command-unavailable',
        message: 'The target raster layer is missing or pixel-locked.' };
    }
  }
  return changedResult(command, execute, 'Adjustment creation is unavailable in this host.',
    { code: 'execution-failed', message: 'The adjustment could not be created.' },
    document.revision, revision);
};

export const dispatchSemanticRasterInvert = async (value: unknown, document: ImageDocument,
  execute: Executor<SemanticRasterInvertCommand>, revision: () => number | undefined
): Promise<ContextualEditResult> => {
  const command = parseSemanticRasterInvertCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  const layer = findDocumentLayer(document, command.layerId);
  if (!layer || (command.channel === 'pixels' && layer.type !== 'raster')
    || (command.channel === 'mask' && !layer.mask) || layerIsLocked(layer, 'pixels')) {
    return { ok: false, code: 'command-unavailable',
      message: 'The requested editable raster or mask channel is unavailable.' };
  }
  return changedResult(command, execute, 'Raster invert is unavailable in this host.',
    { code: 'execution-failed', message: 'The raster channel could not be inverted.' },
    document.revision, revision);
};
