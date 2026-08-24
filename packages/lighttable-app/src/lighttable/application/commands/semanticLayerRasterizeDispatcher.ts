import { layerIsLocked, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  parseSemanticLayerRasterizeCommand,
  type SemanticLayerRasterizeCommand
} from './semanticLayerRasterizeCommandContract';

type LayerRasterizeResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };
type Executor = ((command: SemanticLayerRasterizeCommand) => unknown | Promise<unknown>) | undefined;

export const dispatchSemanticLayerRasterize = async (
  value: unknown,
  document: ImageDocument,
  execute: Executor,
  revision: () => number | undefined
): Promise<LayerRasterizeResult> => {
  const command = parseSemanticLayerRasterizeCommand(value);
  if ('message' in command) {
    return { ok: false, code: 'invalid-parameters', message: command.message };
  }
  const layer = findDocumentLayer(document, command.layerId);
  if (!layer || layerIsLocked(layer, 'pixels')) {
    return { ok: false, code: 'command-unavailable',
      message: 'The target must be an existing layer whose pixels are not locked.' };
  }
  if (!execute) {
    return { ok: false, code: 'command-unavailable',
      message: 'Layer rasterization is unavailable in this host.' };
  }
  const beforeRevision = document.revision;
  const result = await execute(command);
  if (!result) {
    return { ok: false, code: 'execution-failed', message: 'The layer could not be rasterized.' };
  }
  if (revision() === beforeRevision) {
    return { ok: false, code: 'execution-failed', message: 'The edit did not change the document.' };
  }
  return { ok: true, value: result };
};
