import type { DocumentSession } from '../../application/documents/documentSession';
import type { FlowTextEditingSessionController } from '../../application/text/flowTextEditingSession';
import type { ExistingTextHitRenderer } from '../../application/text/ExistingTextHitController';
import type { LayerId } from '../../editor/document/documentTypes';

export interface TextGeometrySource {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): Pick<ExistingTextHitRenderer, 'currentTextEditingLayout'> | null;
  getProjectedDocumentId(): string | null;
  readonly editing: Pick<FlowTextEditingSessionController, 'getSnapshot'>;
  captureScope(): { isCurrent(): boolean };
}

export const textGeometryEditingLayer = (source: TextGeometrySource) => {
  const editing = source.editing.getSnapshot();
  return editing.status === 'editing' ? editing.layerId : null;
};

export const textGeometryDocument = (source: TextGeometrySource) => {
  const snapshot = source.getSession()?.getSnapshot();
  return snapshot?.lifecycle === 'ready' && snapshot.document?.id === source.getProjectedDocumentId()
    ? snapshot.document : null;
};

/** One exact runtime/editing target; canonical revisions may advance through its own commit. */
export const captureTextGeometryScope = (source: TextGeometrySource, layerId: LayerId) => {
  const session = source.getSession(), renderer = source.getRenderer();
  const document = textGeometryDocument(source), scope = source.captureScope();
  const isCurrent = () => Boolean(session && renderer && document && source.getSession() === session
    && source.getRenderer() === renderer && textGeometryDocument(source)?.id === document.id
    && source.editing.getSnapshot().documentId === document.id
    && textGeometryEditingLayer(source) === layerId && scope.isCurrent());
  return isCurrent() && renderer ? { renderer, isCurrent } : null;
};

export const captureTextGeometryRealization = (source: TextGeometrySource, layerId: LayerId) => {
  const scope = captureTextGeometryScope(source, layerId);
  const layout = scope?.renderer.currentTextEditingLayout(layerId);
  return scope && layout && scope.isCurrent() ? { layout, isCurrent: scope.isCurrent } : null;
};
