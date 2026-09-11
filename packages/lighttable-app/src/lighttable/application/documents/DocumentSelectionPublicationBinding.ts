import type { ImageDocument, Rect } from '../../editor/document/documentTypes';
import type { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import { publishBoundSelection, type BoundSelectionRenderer } from '../tools/transform/BoundSelectionPublication';
import type { TransformSelectionPublicationBinding } from '../tools/transform/TransformPublicationOwner';
import { publishTransformDocumentSelection } from '../tools/transform/publishTransformDocumentSelection';
import type { DocumentSession } from './documentSession';

export interface DocumentSelectionProjection {
  readonly selection: readonly SelectionOperation[];
  readonly coverage: SelectionMaskSnapshot;
  readonly selectionRevision: number;
  readonly supportBounds: Rect | null;
}

export interface DocumentSelectionPublicationPort {
  isSessionCurrent(): boolean;
  getDocument(): ImageDocument | null;
  getRenderer(): BoundSelectionRenderer | null;
  getRendererGeneration(): number;
  applyDocumentSnapshot(document: ImageDocument): void;
  publishEditorProjection(projection: DocumentSelectionProjection): void;
}

/** Exact session-bound surface/transform publication; no selection store copy. */
export class DocumentSelectionPublicationBinding {
  constructor(private readonly session: DocumentSession | undefined,
    private readonly port: DocumentSelectionPublicationPort) {}

  private requireSession(): DocumentSession {
    if (!this.session || !this.port.isSessionCurrent()) {
      throw new Error('Document/selection publication requires its current document session.');
    }
    return this.session;
  }

  /** Called inside the surface command/history owner's publication admission. */
  publishSurface = (document: ImageDocument, selection: readonly SelectionOperation[],
    coverage: SelectionMaskSnapshot): void => {
    const session = this.requireSession();
    session.runPublication(() => {
      const store = new DocumentSelectionStateStore(session);
      const snapshot = session.getSnapshot();
      const expectedDocument = snapshot.document;
      if (!expectedDocument) throw new Error('The selection document is unavailable.');
      const lease = store.acquire(snapshot.documentRevision);
      // Provenance explains an edit; exact coverage owns every consumer's bounds.
      const supportBounds = coverage.active ? coverage.measureSupportBounds() : null;
      const nextRevision = (Number(lease.selection.revision) + 1) as typeof lease.selection.revision;
      if (!store.compareAndSwapForDocument(lease.selection.revision, expectedDocument, {
        ...lease.selection, revision: nextRevision,
        canvas: { width: document.width, height: document.height },
        active: coverage.active, coverage, supportBounds, provenance: [...selection]
      }, document)) throw new Error('The selection changed during compound publication.');
      this.port.applyDocumentSnapshot(document);
      this.port.publishEditorProjection({ selection, coverage, supportBounds, selectionRevision: Number(nextRevision) });
    });
  };

  publishTransform = async (document: ImageDocument, selection: readonly SelectionOperation[],
    coverage: SelectionMaskSnapshot, binding: TransformSelectionPublicationBinding): Promise<void> => {
    const session = this.requireSession();
    const rendererIsAddressable = () => this.port.isSessionCurrent()
      && this.port.getRenderer() === binding.renderer
      && this.port.getRendererGeneration() === binding.rendererGeneration;
    const documentBindingIsCurrent = () => rendererIsAddressable()
      && this.port.getDocument() === binding.expectedDocument;
    const bindingIsCurrent = () => {
      if (!documentBindingIsCurrent()) return false;
      const lease = new DocumentSelectionStateStore(session).acquire(session.getSnapshot().documentRevision);
      const expected = binding.expectedSelectionLease;
      return lease.document.sessionId === expected.document.sessionId
        && lease.document.revision === expected.document.revision
        && lease.selection.revision === expected.selection.revision
        && lease.selection.coverage === expected.selection.coverage;
    };
    await publishBoundSelection({
      renderer: binding.renderer, bindingIsCurrent,
      publish: () => publishTransformDocumentSelection({
        session, document, selection, coverage, expectedLease: binding.expectedSelectionLease,
        bindingIsCurrent: documentBindingIsCurrent, rendererIsAddressable,
        publishPixels: binding.publishPixels,
        getProjectedDocument: this.port.getDocument,
        applyDocumentSnapshot: this.port.applyDocumentSnapshot,
        publishEditorProjection: this.port.publishEditorProjection
      })
    });
  };
}
