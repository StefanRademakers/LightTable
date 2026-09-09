import type { AffineMatrix } from '@lighttable/vector-core';
import type {
  ImageDocument,
  VectorLayer
} from '../../editor/document/documentTypes';

export interface VectorTransformPreviewRenderer {
  setVectorSelectionPreviewTransform(matrix: AffineMatrix | null): void;
  updateSemanticLayerTransform(layer: VectorLayer, matrix: AffineMatrix): boolean;
  cancelSemanticLayerTransform(layer: VectorLayer): boolean;
  setVectorContentPreviews(layers: readonly VectorLayer[]): boolean;
  clearVectorContentPreviews(): boolean;
}

export interface VectorTransformPreviewBinding {
  readonly document: ImageDocument;
  readonly rendererGeneration: number;
  isCurrent(): boolean;
  setLayer(layer: VectorLayer, matrix: AffineMatrix, documentOperation: AffineMatrix): boolean;
  clearLayer(layer: VectorLayer): boolean;
  setElements(layers: readonly VectorLayer[], documentOperation: AffineMatrix): boolean;
  clearElements(): boolean;
}

export interface VectorTransformPreviewBindingSource<Renderer extends VectorTransformPreviewRenderer> {
  getDocument(): ImageDocument | null;
  getRenderer(): Renderer | null;
  getRendererGeneration(): number;
}

/**
 * Owns one renderer-hot vector preview lease.
 *
 * Mutation calls require the exact admitted document and renderer generation.
 * Cleanup may address the admitted renderer after canonical commit, but never a
 * replacement renderer or device generation.
 */
export const captureVectorTransformPreviewBinding = <Renderer extends VectorTransformPreviewRenderer>(
  source: VectorTransformPreviewBindingSource<Renderer>
): VectorTransformPreviewBinding | null => {
  const document = source.getDocument();
  const renderer = source.getRenderer();
  if (!document || !renderer) return null;
  const rendererGeneration = source.getRendererGeneration();
  const rendererIsCurrent = () => source.getRenderer() === renderer
    && source.getRendererGeneration() === rendererGeneration;
  const isCurrent = () => rendererIsCurrent() && source.getDocument() === document;
  const clearLayer = (layer: VectorLayer) => {
    if (!rendererIsCurrent()) return false;
    let selectionCleared = true;
    let semanticCleared = true;
    try {
      renderer.setVectorSelectionPreviewTransform(null);
    } catch {
      selectionCleared = false;
    }
    try {
      semanticCleared = renderer.cancelSemanticLayerTransform(layer);
    } catch {
      semanticCleared = false;
    }
    return selectionCleared && semanticCleared;
  };
  const clearElements = () => {
    if (!rendererIsCurrent()) return false;
    let selectionCleared = true;
    let contentCleared = true;
    try {
      renderer.setVectorSelectionPreviewTransform(null);
    } catch {
      selectionCleared = false;
    }
    try {
      contentCleared = renderer.clearVectorContentPreviews();
    } catch {
      contentCleared = false;
    }
    return selectionCleared && contentCleared;
  };
  return {
    document,
    rendererGeneration,
    isCurrent,
    setLayer: (layer, matrix, documentOperation) => {
      if (!isCurrent()) return false;
      try {
        renderer.setVectorSelectionPreviewTransform(documentOperation);
        if (renderer.updateSemanticLayerTransform(layer, matrix)) return true;
      } catch {
        // The preview is an all-or-nothing lease. Best-effort cleanup below.
      }
      clearLayer(layer);
      return false;
    },
    clearLayer,
    setElements: (layers, documentOperation) => {
      if (!isCurrent()) return false;
      try {
        renderer.setVectorSelectionPreviewTransform(documentOperation);
        if (renderer.setVectorContentPreviews(layers)) return true;
      } catch {
        // The preview is an all-or-nothing lease. Best-effort cleanup below.
      }
      clearElements();
      return false;
    },
    clearElements
  };
};
