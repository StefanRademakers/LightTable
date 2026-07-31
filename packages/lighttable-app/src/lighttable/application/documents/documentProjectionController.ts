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

export interface DocumentProjectionPort {
  getDocument(): ImageDocument | null;
  publishDocument(document: ImageDocument | null): void;
  getDocumentAdjustments(): BasicAdjustments;
  publishDocumentAdjustments(adjustments: BasicAdjustments): void;
  publishEditorAdjustments(adjustments: BasicAdjustments): void;
  getGroupVisibility(): GroupVisibility;
  publishGroupVisibility(visibility: GroupVisibility): void;
  publishRendererDocument(document: ImageDocument): void;
  publishRendererAdjustments(adjustments: BasicAdjustments): void;
}

export interface DocumentProjectionController {
  previewAdjustmentSnapshot(
    snapshot: BasicAdjustments,
    targetLayerId?: LayerId | null
  ): void;
  applyAdjustmentSnapshot(
    snapshot: BasicAdjustments,
    targetLayerId?: LayerId | null
  ): void;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyGroupVisibilitySnapshot(visibility: GroupVisibility): void;
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
  const publishRendererAdjustments = () => {
    port.publishRendererAdjustments(applyGroupVisibility(
      port.getDocumentAdjustments(),
      port.getGroupVisibility()
    ));
  };

  const projectAdjustments = (
    snapshot: BasicAdjustments,
    targetLayerId: LayerId | null,
    publishCanonicalDocument: boolean
  ) => {
    const currentDocument = port.getDocument();
    const projection = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId,
      document: currentDocument,
      documentAdjustments: port.getDocumentAdjustments()
    });
    port.publishEditorAdjustments(projection.editorAdjustments);
    if (publishCanonicalDocument) {
      port.publishDocumentAdjustments(projection.documentAdjustments);
      if (projection.document !== currentDocument) {
        port.publishDocument(projection.document);
      }
    }
    if (projection.document) {
      port.publishRendererDocument(projection.document);
    }
    publishRendererAdjustments();
  };

  return {
    previewAdjustmentSnapshot: (snapshot, targetLayerId = null) => {
      projectAdjustments(snapshot, targetLayerId, false);
    },
    applyAdjustmentSnapshot: (
      snapshot,
      targetLayerId = null
    ) => {
      projectAdjustments(snapshot, targetLayerId, true);
    },
    applyDocumentSnapshot: (document) => {
      port.publishDocument(document);
      port.publishRendererDocument(document);
      publishRendererAdjustments();
    },
    applyGroupVisibilitySnapshot: (visibility) => {
      port.publishGroupVisibility(visibility);
      publishRendererAdjustments();
    }
  };
};
