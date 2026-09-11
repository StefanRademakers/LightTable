import type { ImageDocument } from '../../editor/document/documentTypes';
import type { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { DocumentSession } from '../documents/documentSession';

export type ProjectDocumentSurface = (document: ImageDocument, coverage: SelectionMaskSnapshot) => void;
export class DocumentSurfaceHistoryError extends Error {}
export interface DocumentSurfaceHistoryRenderer {
  publishDocumentSurfaceHistory(resourceOwner: object, publish: (project: ProjectDocumentSurface) => void,
    isIndeterminate: (reason: unknown) => boolean): Promise<void>;
}

/** History outlives presentation. Resolve one current binding of the originating session per replay. */
export class DocumentSurfaceHistoryBinding {
  constructor(private readonly session: DocumentSession | undefined, private readonly port: {
    isSessionCurrent(): boolean;
    getRenderer(): DocumentSurfaceHistoryRenderer | null;
    getGeneration(): number;
  }) {}

  publish = async (resourceOwner: object, publish: (project: ProjectDocumentSurface) => void): Promise<void> => {
    const session = this.session;
    const renderer = this.port.getRenderer();
    if (!session || !renderer || !this.port.isSessionCurrent()) {
      throw new Error('Surface history requires its current document renderer.');
    }
    const generation = this.port.getGeneration();
    const document = session.getSnapshot().document;
    const admission = session.acquireHistoryPublicationAdmission('Document surface history is publishing.');
    try {
      await renderer.publishDocumentSurfaceHistory(resourceOwner, project => {
        if (!this.port.isSessionCurrent() || this.port.getRenderer() !== renderer
          || this.port.getGeneration() !== generation || session.getSnapshot().document !== document) {
          throw new Error('The document surface history binding changed before publication.');
        }
        admission.run(() => publish(project));
      }, reason => reason instanceof DocumentSurfaceHistoryError);
    } finally {
      admission.release();
    }
  };
}
