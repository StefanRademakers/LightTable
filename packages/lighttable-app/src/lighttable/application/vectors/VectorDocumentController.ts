import {
  PathMutationSession,
  type VectorPath
} from '@lighttable/vector-core';
import {
  appendVectorPath,
  createVectorLayer,
  deleteVectorPaths,
  replaceVectorPath
} from '../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface VectorDocumentControllerDependencies {
  getDocument(): ImageDocument | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
}

interface ActivePathMutation {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  pathId: string;
  beforeDocument: ImageDocument;
  session: PathMutationSession;
}

interface ActivePathCreation {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  pathId: string;
  beforeDocument: ImageDocument;
}

/**
 * Application boundary for native vector mutations.
 *
 * Pure document commands remain unaware of interaction lifetime. This
 * controller turns arbitrarily many pointer-move previews into one history
 * entry and refuses to leak an edit into a newly activated document.
 */
export class VectorDocumentController {
  private activeMutation: ActivePathMutation | null = null;
  private activeCreation: ActivePathCreation | null = null;

  constructor(
    private readonly resolveDependencies: () => VectorDocumentControllerDependencies
  ) {}

  createLayer(paths: readonly VectorPath[] = [], name = 'Shape') {
    return this.applyAtomic((document) => createVectorLayer(document, paths, name));
  }

  appendPath(layerId: LayerId, path: VectorPath) {
    return this.applyAtomic((document) => appendVectorPath(document, layerId, path));
  }

  deletePaths(layerId: LayerId, pathIds: readonly string[]) {
    return this.applyAtomic((document) => deleteVectorPaths(document, layerId, pathIds));
  }

  /**
   * Opens a path-creation transaction without producing history yet.
   *
   * The provisional path is inserted into an editable active vector layer, or
   * into a newly created vector layer when the current target cannot own it.
   * Subsequent previews replace that same path. Committing records the entire
   * gesture as one history item; cancelling restores the exact opening tree.
   */
  beginPathCreation(path: VectorPath, name = 'Shape'): LayerId | null {
    this.cancelActiveInteraction();
    const dependencies = this.resolveDependencies();
    const beforeDocument = dependencies.getDocument();
    if (!beforeDocument) return null;

    const activeLayer = beforeDocument.activeLayerId
      ? findDocumentLayer(beforeDocument, beforeDocument.activeLayerId)
      : null;
    const canAppendToActive = activeLayer?.type === 'vector'
      && !layerIsLocked(activeLayer, 'pixels');
    const previewDocument = canAppendToActive
      ? appendVectorPath(beforeDocument, activeLayer.id, path)
      : createVectorLayer(beforeDocument, [path], name);
    const layerId = canAppendToActive
      ? activeLayer.id
      : previewDocument.activeLayerId;
    if (!layerId) return null;

    this.activeCreation = {
      documentId: beforeDocument.id,
      layerId,
      pathId: path.id,
      beforeDocument
    };
    dependencies.applyDocumentSnapshot(previewDocument);
    return layerId;
  }

  previewPathCreation(path: VectorPath) {
    const active = this.activeCreation;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || document?.id !== active.documentId || path.id !== active.pathId) {
      this.activeCreation = null;
      return false;
    }
    const layer = findDocumentLayer(document, active.layerId);
    if (layer?.type !== 'vector' || !layer.paths.some(({ id }) => id === active.pathId)) {
      this.activeCreation = null;
      return false;
    }
    const next = replaceVectorPath(document, active.layerId, path);
    if (next === document) return false;
    dependencies.applyDocumentSnapshot(next);
    return true;
  }

  commitPathCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== active.documentId) return false;
    dependencies.pushDocumentHistory(active.beforeDocument, document);
    return true;
  }

  cancelPathCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    const dependencies = this.resolveDependencies();
    if (dependencies.getDocument()?.id !== active.documentId) return false;
    dependencies.applyDocumentSnapshot(active.beforeDocument);
    return true;
  }

  beginPathMutation(layerId: LayerId, pathId: string) {
    this.cancelActiveInteraction();
    const document = this.resolveDependencies().getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    const path = layer?.type === 'vector'
      ? layer.paths.find(({ id }) => id === pathId)
      : null;
    if (!document || !path) return false;
    this.activeMutation = {
      documentId: document.id,
      layerId,
      pathId,
      beforeDocument: document,
      session: new PathMutationSession(path)
    };
    return true;
  }

  previewPathMutation(mutate: (openingSnapshot: VectorPath) => VectorPath) {
    const active = this.activeMutation;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || document?.id !== active.documentId) {
      this.activeMutation = null;
      return false;
    }
    const layer = findDocumentLayer(document, active.layerId);
    if (layer?.type !== 'vector' || !layer.paths.some(({ id }) => id === active.pathId)) {
      this.activeMutation = null;
      return false;
    }
    const preview = active.session.update(mutate);
    const next = replaceVectorPath(document, active.layerId, preview);
    if (next === document) return false;
    dependencies.applyDocumentSnapshot(next);
    return true;
  }

  commitPathMutation() {
    const active = this.activeMutation;
    if (!active) return false;
    this.activeMutation = null;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== active.documentId) return false;
    const commit = active.session.commit();
    if (!commit) {
      dependencies.applyDocumentSnapshot(active.beforeDocument);
      return false;
    }
    dependencies.pushDocumentHistory(active.beforeDocument, document);
    return true;
  }

  cancelPathMutation() {
    const active = this.activeMutation;
    if (!active) return false;
    this.activeMutation = null;
    active.session.cancel();
    const dependencies = this.resolveDependencies();
    if (dependencies.getDocument()?.id !== active.documentId) return false;
    dependencies.applyDocumentSnapshot(active.beforeDocument);
    return true;
  }

  dispose() {
    this.cancelActiveInteraction();
  }

  private applyAtomic(change: (document: ImageDocument) => ImageDocument) {
    if (this.activeMutation || this.activeCreation) return false;
    const dependencies = this.resolveDependencies();
    const before = dependencies.getDocument();
    if (!before) return false;
    const after = change(before);
    if (after === before) return false;
    dependencies.applyDocumentSnapshot(after);
    dependencies.pushDocumentHistory(before, after);
    return true;
  }

  private cancelActiveInteraction() {
    if (this.activeCreation) return this.cancelPathCreation();
    if (this.activeMutation) return this.cancelPathMutation();
    return false;
  }
}
