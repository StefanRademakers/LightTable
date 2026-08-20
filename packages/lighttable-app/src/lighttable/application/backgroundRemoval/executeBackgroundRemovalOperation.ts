import type { ImageDocument, LayerId, RasterLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import type { BackgroundRemovalMaskMode } from '../commands/semanticBackgroundRemovalCommandContract';
import type { BackgroundRemovalModel, BackgroundRemovalProgress } from './backgroundRemovalTypes';

export interface BackgroundRemovalRenderer {
  exportLayerForBackgroundRemoval(document: ImageDocument, layer: RasterLayer): Promise<Blob>;
}

export interface ExecuteBackgroundRemovalOperationOptions {
  readonly document: ImageDocument;
  readonly layer: RasterLayer;
  readonly renderer: BackgroundRemovalRenderer;
  readonly model: BackgroundRemovalModel;
  readonly mode: BackgroundRemovalMaskMode;
  readonly signal: AbortSignal;
  readonly getDocument: () => ImageDocument | null;
  readonly applyMask: (layerId: LayerId, mask: RasterSelectionMask, mode: BackgroundRemovalMaskMode) => boolean;
  readonly onProgress?: (progress: BackgroundRemovalProgress) => void;
}

export const executeBackgroundRemovalOperation = async ({
  document, layer, renderer, model, mode, signal, getDocument, applyMask, onProgress
}: ExecuteBackgroundRemovalOperationOptions) => {
  const source = { documentId: document.id, revision: document.revision, layerId: layer.id };
  const image = await renderer.exportLayerForBackgroundRemoval(document, layer);
  if (signal.aborted) throw new DOMException('Background removal was canceled.', 'AbortError');
  const result = await model.remove(image, { signal, onProgress });
  if (signal.aborted) throw new DOMException('Background removal was canceled.', 'AbortError');
  const current = getDocument();
  if (!current || current.id !== source.documentId || current.revision !== source.revision
    || !findDocumentLayer(current, source.layerId)) {
    throw new Error('Background-removal result was discarded because the document changed.');
  }
  if (!applyMask(source.layerId, result.mask, mode)) {
    throw new Error('The generated background mask could not be applied.');
  }
  return { layerId: source.layerId, mode, modelId: result.modelId, backend: result.backend,
    durationMs: result.durationMs };
};
