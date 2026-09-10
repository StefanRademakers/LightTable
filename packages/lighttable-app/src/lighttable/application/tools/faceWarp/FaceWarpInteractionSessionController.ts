import type {
  ImageDocument,
  LayerId
} from '../../../editor/document/documentTypes';
import type { FaceWarpFace, FaceWarpPoint } from '../../../effects/faceWarp/faceWarpTypes';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

export type FaceWarpInteractionMode = 'sculpt' | 'relax' | 'restore';

export interface FaceWarpGestureContext {
  readonly pointerId: number;
  readonly faceId: string;
  readonly seedSource: FaceWarpPoint;
  readonly startPointerSource: FaceWarpPoint;
  readonly originalDisplacements: FaceWarpFace['displacements'];
  latestRadius: number;
  mode: FaceWarpInteractionMode;
}

export interface FaceWarpRendererBinding {
  isCurrent(): boolean;
  setMode(mode: FaceWarpInteractionMode | null): void;
}

export interface FaceWarpInteractionDependencies {
  getDocument(): ImageDocument | null;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  acquireRendererBinding(): FaceWarpRendererBinding | null;
  setError(message: string): void;
}

export interface FaceWarpInteractionSessionController {
  readonly active: boolean;
  readonly gesture: FaceWarpGestureContext | null;
  beginEdit(): boolean;
  changeDocument(
    mutate: (document: ImageDocument) => ImageDocument,
    recordHistory?: boolean
  ): boolean;
  commitEdit(): boolean;
  cancelEdit(): boolean;
  beginGesture(documentId: ImageDocument['id'], layerId: LayerId, context: FaceWarpGestureContext): boolean;
  owns(pointerId: number): boolean;
  changeGesture(
    pointerId: number,
    mode: FaceWarpInteractionMode,
    mutate: (document: ImageDocument, context: FaceWarpGestureContext) => ImageDocument
  ): boolean;
  finishGesture(
    pointerId: number,
    refine?: (document: ImageDocument, context: FaceWarpGestureContext) => ImageDocument
  ): boolean;
  cancelGesture(pointerId: number): boolean;
  reset(): void;
}

interface ActiveEdit {
  readonly dependencies: FaceWarpInteractionDependencies;
  readonly transaction: DocumentMutationTransaction;
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId | null;
  readonly binding: FaceWarpRendererBinding | null;
  bindingActive: boolean;
  gesture: FaceWarpGestureContext | null;
}

/**
 * Owns Face Warp edits from pointer admission through renderer cleanup and history commit.
 * React may present the controls, but it cannot replace the admitted document, layer,
 * renderer generation or transaction midway through a gesture.
 */
export const createFaceWarpInteractionSessionController = (
  resolveDependencies: () => FaceWarpInteractionDependencies
): FaceWarpInteractionSessionController => {
  let active: ActiveEdit | null = null;

  const report = (edit: ActiveEdit | null, reason: unknown, fallback: string) => {
    edit?.dependencies.setError(reason instanceof Error ? reason.message : fallback);
  };

  const cleanupBinding = (edit: ActiveEdit) => {
    if (!edit.bindingActive) return;
    edit.bindingActive = false;
    try {
      edit.binding?.setMode(null);
    } catch (reason) {
      report(edit, reason, 'Face Warp renderer cleanup failed.');
    }
  };

  const closeState = (edit: ActiveEdit) => {
    cleanupBinding(edit);
    edit.gesture = null;
    if (active === edit) active = null;
  };

  const currentDocument = (edit: ActiveEdit): ImageDocument | null => {
    const document = edit.dependencies.getDocument();
    if (!edit.transaction.active || document?.id !== edit.documentId) return null;
    if (edit.layerId && document.activeLayerId !== edit.layerId) return null;
    try {
      if (edit.binding && !edit.binding.isCurrent()) return null;
    } catch (reason) {
      report(edit, reason, 'Face Warp renderer validation failed.');
      return null;
    }
    return edit.transaction.current;
  };

  const close = (commit: boolean): boolean => {
    const edit = active;
    if (!edit) return false;
    return commit ? edit.transaction.commit() : edit.transaction.cancel();
  };

  const beginEdit = (): boolean => {
    if (active?.transaction.active) return false;
    active = null;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    if (!document) return false;
    let edit: ActiveEdit | null = null;
    const transaction = dependencies.documentMutations.begin(
      'face-warp',
      { label: 'Face Warp', type: 'layer.face-warp' },
      () => { if (edit) closeState(edit); },
      'cancel'
    );
    if (!transaction) return false;
    edit = {
      dependencies,
      transaction,
      documentId: document.id,
      layerId: null,
      binding: null,
      bindingActive: false,
      gesture: null
    };
    active = edit;
    return true;
  };

  return {
    get active() {
      return active?.transaction.active === true;
    },
    get gesture() {
      return active?.gesture ?? null;
    },
    beginEdit,
    changeDocument: (mutate, recordHistory = true) => {
      const edit = active;
      if (edit?.transaction.active) {
        if (!currentDocument(edit)) {
          edit.transaction.cancel();
          return false;
        }
        return edit.transaction.change(mutate);
      }
      return resolveDependencies().documentMutations.change(mutate, recordHistory);
    },
    commitEdit: () => close(true),
    cancelEdit: () => close(false),
    beginGesture: (documentId, layerId, context) => {
      if (active?.transaction.active) return false;
      active = null;
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || document.id !== documentId) return false;
      const binding = dependencies.acquireRendererBinding();
      if (!binding) return false;
      try {
        if (!binding.isCurrent()) return false;
      } catch (reason) {
        dependencies.setError(
          reason instanceof Error ? reason.message : 'Face Warp renderer validation failed.'
        );
        return false;
      }
      let edit: ActiveEdit | null = null;
      const transaction = dependencies.documentMutations.begin(
        'face-warp.gesture',
        { label: 'Face Warp', type: 'layer.face-warp', layerIds: [layerId] },
        () => { if (edit) closeState(edit); },
        'cancel'
      );
      if (!transaction) return false;
      edit = {
        dependencies,
        transaction,
        documentId,
        layerId,
        binding,
        bindingActive: false,
        gesture: context
      };
      active = edit;
      try {
        binding.setMode(context.mode);
        edit.bindingActive = true;
      } catch (reason) {
        report(edit, reason, 'Face Warp renderer admission failed.');
        transaction.cancel();
        return false;
      }
      return true;
    },
    owns: (pointerId) => active?.gesture?.pointerId === pointerId,
    changeGesture: (pointerId, mode, mutate) => {
      const edit = active;
      const context = edit?.gesture;
      if (!edit || !context || context.pointerId !== pointerId || !currentDocument(edit)) {
        edit?.transaction.cancel();
        return false;
      }
      try {
        edit.binding?.setMode(mode);
        context.mode = mode;
        return edit.transaction.change((document) => mutate(document, context));
      } catch (reason) {
        report(edit, reason, 'Face Warp preview failed.');
        edit.transaction.cancel();
        return false;
      }
    },
    finishGesture: (pointerId, refine) => {
      const edit = active;
      const context = edit?.gesture;
      if (!edit || !context || context.pointerId !== pointerId) return false;
      if (!currentDocument(edit)) {
        edit.transaction.cancel();
        return false;
      }
      cleanupBinding(edit);
      edit.gesture = null;
      if (!refine || context.mode !== 'sculpt' || context.latestRadius <= 0) {
        return edit.transaction.commit();
      }
      try {
        if (!edit.transaction.change((document) => refine(document, context))) {
          edit.transaction.cancel();
          return false;
        }
        return edit.transaction.commit();
      } catch (reason) {
        report(edit, reason, 'Face Warp refinement failed.');
        edit.transaction.cancel();
        return false;
      }
    },
    cancelGesture: (pointerId) => {
      if (active?.gesture?.pointerId !== pointerId) return false;
      return close(false);
    },
    reset: () => {
      if (active) close(false);
    }
  };
};
