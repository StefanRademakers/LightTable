import {
  cloneVectorPath,
  invertMatrix,
  multiplyMatrices,
  PathMutationSession,
  type AffineMatrix,
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
import {
  buildSceneTransformIndex,
  requireSceneTransform
} from '../../editor/document/sceneTransformGraph';

export interface VectorDocumentControllerDependencies {
  getDocument(): ImageDocument | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
}

export interface VectorPathEdit {
  readonly layerId: LayerId;
  readonly pathId: string;
  readonly edit: (path: VectorPath) => VectorPath | null;
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

export interface VectorPathCreationPlacement {
  layerId: LayerId;
  /** Path rebased for persistence in the selected vector layer. */
  path: VectorPath;
  /** Effective path-local to document-space mapping. */
  pathToDocument: AffineMatrix;
  /** Effective document-space to path-local mapping. */
  documentToPath: AffineMatrix;
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
   * Applies edits across any number of vector layers as one document command.
   * Returning null removes the addressed path. Duplicate path addresses are
   * rejected so edit order can never change the meaning of a transaction.
   */
  editPaths(edits: readonly VectorPathEdit[]) {
    if (edits.length === 0) return false;
    const addressed = new Set<string>();
    for (const { layerId, pathId } of edits) {
      const key = `${layerId}\0${pathId}`;
      if (addressed.has(key)) throw new Error(`Duplicate vector path edit ${layerId}/${pathId}.`);
      addressed.add(key);
    }

    // Preflight every address against the same opening snapshot. A multi-path
    // command must never partially succeed because one target disappeared or
    // became locked between selection and execution.
    const openingDocument = this.resolveDependencies().getDocument();
    if (!openingDocument || edits.some(({ layerId, pathId }) => {
      const layer = findDocumentLayer(openingDocument, layerId);
      return layer?.type !== 'vector'
        || layerIsLocked(layer, 'pixels')
        || !layer.paths.some(({ id }) => id === pathId);
    })) return false;

    return this.applyAtomic((openingDocument) => {
      let document = openingDocument;
      for (const change of edits) {
        const layer = findDocumentLayer(document, change.layerId);
        // The complete address set was validated above. These guards only
        // protect the transaction from an edit that unexpectedly invalidates
        // a later target.
        if (layer?.type !== 'vector') return openingDocument;
        const path = layer.paths.find(({ id }) => id === change.pathId);
        if (!path) return openingDocument;
        const edited = change.edit(path);
        document = edited
          ? replaceVectorPath(document, change.layerId, edited)
          : deleteVectorPaths(document, change.layerId, [change.pathId]);
      }
      return document;
    });
  }

  /**
   * Opens a path-creation transaction without producing history yet.
   *
   * The provisional path is inserted into an editable active vector layer, or
   * into a newly created vector layer when the current target cannot own it.
   * Subsequent previews replace that same path. Committing records the entire
   * gesture as one history item; cancelling restores the exact opening tree.
   */
  beginPathCreation(path: VectorPath, name = 'Shape'): VectorPathCreationPlacement | null {
    this.cancelActiveInteraction();
    const dependencies = this.resolveDependencies();
    const beforeDocument = dependencies.getDocument();
    if (!beforeDocument) return null;

    const activeLayer = beforeDocument.activeLayerId
      ? findDocumentLayer(beforeDocument, beforeDocument.activeLayerId)
      : null;
    const canAppendToActive = activeLayer?.type === 'vector'
      && !layerIsLocked(activeLayer, 'pixels');
    let previewDocument = canAppendToActive
      ? appendVectorPath(beforeDocument, activeLayer.id, path)
      : createVectorLayer(beforeDocument, [path], name);
    const layerId = canAppendToActive
      ? activeLayer.id
      : previewDocument.activeLayerId;
    if (!layerId) return null;

    // Pen input arrives in document space. Persist the inverse layer mapping
    // on the path so nested/transformed vector layers do not reinterpret new
    // anchors as layer-local pixels. The effective path transform remains the
    // transform supplied by the caller (identity for a newly started path).
    const layerToDocument = requireSceneTransform(
      buildSceneTransformIndex(previewDocument),
      layerId
    ).localToDocument;
    const documentToLayer = invertMatrix(layerToDocument);
    const documentToPath = invertMatrix(path.transform);
    if (!documentToLayer || !documentToPath) return null;
    const storedPath = cloneVectorPath(path);
    storedPath.transform = multiplyMatrices(documentToLayer, path.transform);
    previewDocument = replaceVectorPath(previewDocument, layerId, storedPath);

    this.activeCreation = {
      documentId: beforeDocument.id,
      layerId,
      pathId: path.id,
      beforeDocument
    };
    dependencies.applyDocumentSnapshot(previewDocument);
    return {
      layerId,
      path: cloneVectorPath(storedPath),
      pathToDocument: { ...path.transform },
      documentToPath: { ...documentToPath }
    };
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
    if (!document || !path || !layer || layerIsLocked(layer, 'pixels')) return false;
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

  /**
   * Finalizes the active Pen transaction while atomically absorbing another
   * path. The opening document remains the sole undo snapshot, so provisional
   * anchors, topology replacement and source removal can never split across
   * history entries.
   */
  commitActivePathConnection(
    targetLayerId: LayerId,
    targetPathId: string,
    connectedPath: VectorPath
  ) {
    const interaction = this.activeMutation ?? this.activeCreation;
    if (!interaction || connectedPath.id !== interaction.pathId) return false;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== interaction.documentId) {
      this.activeMutation = null;
      this.activeCreation = null;
      return false;
    }
    const activeLayer = findDocumentLayer(document, interaction.layerId);
    const targetLayer = findDocumentLayer(document, targetLayerId);
    if (
      activeLayer?.type !== 'vector'
      || targetLayer?.type !== 'vector'
      || layerIsLocked(activeLayer, 'pixels')
      || layerIsLocked(targetLayer, 'pixels')
      || !activeLayer.paths.some(({ id }) => id === interaction.pathId)
      || !targetLayer.paths.some(({ id }) => id === targetPathId)
    ) return false;

    if (this.activeMutation) {
      this.activeMutation.session.update(() => connectedPath);
    }
    let next = replaceVectorPath(document, interaction.layerId, connectedPath);
    if (targetLayerId !== interaction.layerId || targetPathId !== interaction.pathId) {
      next = deleteVectorPaths(next, targetLayerId, [targetPathId]);
    }
    dependencies.applyDocumentSnapshot(next);
    if (this.activeMutation && !this.activeMutation.session.commit()) {
      this.activeMutation = null;
      dependencies.applyDocumentSnapshot(interaction.beforeDocument);
      return false;
    }
    this.activeMutation = null;
    this.activeCreation = null;
    dependencies.pushDocumentHistory(interaction.beforeDocument, next);
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
