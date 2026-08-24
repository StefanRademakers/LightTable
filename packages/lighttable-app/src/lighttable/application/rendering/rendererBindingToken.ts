import type { ImageDocument } from '../../editor/document/documentTypes';

export interface RendererBindingToken<Renderer extends object> {
  readonly document: ImageDocument;
  readonly renderer: Renderer;
  readonly rendererGeneration: number;
  isCurrent(): boolean;
  assertCurrent(operation: string): void;
}

export interface RendererBindingSource<Renderer extends object> {
  getDocument(): ImageDocument | null;
  getRenderer(): Renderer | null;
  getRendererGeneration(): number;
}

/**
 * Captures the complete identity needed by an asynchronous renderer operation.
 * The token owns no document or GPU state; it only rejects publication after
 * a tab switch, canonical edit or renderer/device replacement.
 */
export const captureRendererBinding = <Renderer extends object>(
  source: RendererBindingSource<Renderer>
): RendererBindingToken<Renderer> => {
  const document = source.getDocument();
  const renderer = source.getRenderer();
  if (!document || !renderer) throw new Error('The document renderer is not ready.');
  const documentId = document.id;
  const documentRevision = document.revision;
  const rendererGeneration = source.getRendererGeneration();
  const isCurrent = () => {
    const currentDocument = source.getDocument();
    return source.getRenderer() === renderer
      && source.getRendererGeneration() === rendererGeneration
      && currentDocument?.id === documentId
      && currentDocument.revision === documentRevision;
  };
  return {
    document,
    renderer,
    rendererGeneration,
    isCurrent,
    assertCurrent: (operation) => {
      if (!isCurrent()) {
        throw new Error(`${operation} was canceled because the document renderer changed.`);
      }
    }
  };
};
