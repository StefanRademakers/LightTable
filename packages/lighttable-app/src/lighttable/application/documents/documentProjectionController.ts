import {
  applyGroupVisibility,
  type GroupVisibility
} from '../adjustments/groupVisibility';
import { projectAdjustmentSnapshot } from '../adjustments/projectAdjustmentSnapshot';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import type { AdjustmentPresentationDomain } from '../adjustments/adjustmentPresentationStore';

export interface DocumentProjectionPort {
  getDocument(): ImageDocument | null;
  publishDocument(document: ImageDocument | null): void;
  getDocumentAdjustments(): BasicAdjustments;
  publishDocumentAdjustments(adjustments: BasicAdjustments): void;
  publishEditorAdjustments(
    adjustments: BasicAdjustments,
    domain: AdjustmentPresentationDomain
  ): void;
  stageEditorAdjustments(adjustments: BasicAdjustments): void;
  getGroupVisibility(): GroupVisibility;
  publishGroupVisibility(visibility: GroupVisibility): void;
  publishRendererDocument(document: ImageDocument): void;
  publishRendererAdjustments(adjustments: BasicAdjustments): void;
}

export interface DocumentProjectionController {
  previewAdjustmentSnapshot(
    snapshot: BasicAdjustments,
    targetLayerId?: LayerId | null,
    domain?: AdjustmentPresentationDomain
  ): void;
  applyAdjustmentSnapshot(
    snapshot: BasicAdjustments,
    targetLayerId?: LayerId | null,
    domain?: AdjustmentPresentationDomain
  ): void;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyGroupVisibilitySnapshot(visibility: GroupVisibility): void;
  discardAdjustmentPreview(): void;
}

/**
 * Atomically projects canonical document and grade state into editor and
 * renderer ports.
 *
 * This is the only place where contextual Grade state and document-output
 * effects are projected together. Raster-local Grade and Grade Layers remain
 * embedded in their owners and are never duplicated into renderer-global
 * creative settings.
 */
export const createDocumentProjectionController = (
  port: DocumentProjectionPort
): DocumentProjectionController => {
  let previewDocument: ImageDocument | null = null;
  const publishRendererAdjustments = () => {
    port.publishRendererAdjustments(applyGroupVisibility(
      port.getDocumentAdjustments(),
      port.getGroupVisibility()
    ));
  };

  const projectAdjustments = (
    snapshot: BasicAdjustments,
    targetLayerId: LayerId | null,
    publishCanonicalDocument: boolean,
    domain: AdjustmentPresentationDomain
  ) => {
    const canonicalDocument = port.getDocument();
    const currentDocument = !publishCanonicalDocument
      && previewDocument?.id === canonicalDocument?.id
      ? previewDocument
      : canonicalDocument;
    const projection = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId,
      document: currentDocument,
      documentAdjustments: port.getDocumentAdjustments()
    });
    if (publishCanonicalDocument) {
      previewDocument = null;
      port.publishEditorAdjustments(projection.editorAdjustments, domain);
    } else {
      // Pointer-rate previews only advance the authoritative ref used by the
      // next mutation. The active slider owns its thumb/value locally; waking
      // React's external-store subscribers here would synchronously rerender
      // the complete contextual panel for every native input sample.
      port.stageEditorAdjustments(projection.editorAdjustments);
      previewDocument = projection.document;
    }
    if (publishCanonicalDocument) {
      port.publishDocumentAdjustments(projection.documentAdjustments);
      if (projection.document !== currentDocument) {
        port.publishDocument(projection.document);
      }
    }
    if (projection.document) {
      port.publishRendererDocument(projection.document);
    }
    if (!publishCanonicalDocument && projection.scope === 'document') {
      port.publishRendererAdjustments(applyGroupVisibility(
        projection.documentAdjustments,
        port.getGroupVisibility()
      ));
    } else {
      publishRendererAdjustments();
    }
  };

  return {
    previewAdjustmentSnapshot: (snapshot, targetLayerId = null, domain = 'all') => {
      projectAdjustments(snapshot, targetLayerId, false, domain);
    },
    applyAdjustmentSnapshot: (
      snapshot,
      targetLayerId = null,
      domain = 'all'
    ) => {
      projectAdjustments(snapshot, targetLayerId, true, domain);
    },
    applyDocumentSnapshot: (document) => {
      previewDocument = null;
      port.publishDocument(document);
      port.publishRendererDocument(document);
      publishRendererAdjustments();
    },
    applyGroupVisibilitySnapshot: (visibility) => {
      port.publishGroupVisibility(visibility);
      publishRendererAdjustments();
    },
    discardAdjustmentPreview: () => {
      previewDocument = null;
    }
  };
};
