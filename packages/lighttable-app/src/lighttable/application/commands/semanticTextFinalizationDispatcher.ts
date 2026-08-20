import { layerIsLocked, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  parseSemanticTextFinalizationCommand,
  type SemanticTextFinalizationCommand
} from './semanticTextFinalizationCommandContract';

type TextFinalizationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };
type Executor = ((command: SemanticTextFinalizationCommand) => unknown | Promise<unknown>) | undefined;

export const dispatchSemanticTextFinalization = async (
  value: unknown,
  document: ImageDocument,
  operation: 'convert to shape' | 'rasterize',
  execute: Executor,
  revision: () => number | undefined
): Promise<TextFinalizationResult> => {
  const label = operation === 'rasterize' ? 'Text rasterize' : 'Text to shape';
  const command = parseSemanticTextFinalizationCommand(value, label);
  if ('message' in command) {
    return { ok: false, code: 'invalid-parameters', message: command.message };
  }
  const layer = findDocumentLayer(document, command.layerId);
  if (layer?.type !== 'text' || layerIsLocked(layer, 'pixels')) {
    return { ok: false, code: 'command-unavailable',
      message: 'The target must be an existing editable text layer.' };
  }
  if (!execute) {
    return { ok: false, code: 'command-unavailable',
      message: `Text ${operation} is unavailable in this host.` };
  }
  const beforeRevision = document.revision;
  const result = await execute(command);
  if (!result) {
    return { ok: false, code: 'execution-failed',
      message: `The text layer could not ${operation === 'rasterize' ? 'be rasterized' : 'be converted to shapes'}.` };
  }
  if (revision() === beforeRevision) {
    return { ok: false, code: 'execution-failed', message: 'The edit did not change the document.' };
  }
  return { ok: true, value: result };
};
