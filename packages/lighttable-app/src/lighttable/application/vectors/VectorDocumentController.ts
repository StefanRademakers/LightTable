import {
  cloneVectorElement,
  cloneVectorPath,
  invertMatrix,
  multiplyMatrices,
  PathMutationSession,
  type AffineMatrix,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import {
  appendVectorElement,
  appendVectorPath,
  convertVectorLiveShapeToPath,
  createVectorLayer,
  deleteVectorPaths,
  deleteVectorElements,
  replaceVectorElement,
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

export interface VectorElementEdit {
  readonly layerId: LayerId;
  readonly elementId: string;
  readonly edit: (element: VectorElement) => VectorElement | null;
}

interface ActivePathMutation {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  pathId: string;
  beforeDocument: ImageDocument;
  session: PathMutationSession;
}

interface ActiveElementMutation {
  documentId: ImageDocument['id'];
  beforeDocument: ImageDocument;
  elements: Array<{
    layerId: LayerId;
    elementId: string;
    openingElement: VectorElement;
  }>;
  changed: boolean;
}

interface ActiveElementCreation {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  elementId: string;
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

export interface VectorElementCreationPlacement<TElement extends VectorElement = VectorElement> {
  layerId: LayerId;
  /** Element rebased for persistence in the selected vector layer. */
  element: TElement;
  /** Effective element-local to document-space mapping. */
  elementToDocument: AffineMatrix;
  /** Effective document-space to element-local mapping. */
  documentToElement: AffineMatrix;
  /** Rebase used to persist subsequent document-space previews in the layer. */
  documentToLayer: AffineMatrix;
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
  private activeElementMutation: ActiveElementMutation | null = null;
  private activeCreation: ActiveElementCreation | null = null;

  constructor(
    private readonly resolveDependencies: () => VectorDocumentControllerDependencies
  ) {}

  createLayer(elements: readonly VectorElement[] = [], name = 'Shape') {
    return this.applyAtomic((document) => createVectorLayer(document, elements, name));
  }

  appendPath(layerId: LayerId, path: VectorPath) {
    return this.applyAtomic((document) => appendVectorPath(document, layerId, path));
  }

  convertLiveShapeToPath(layerId: LayerId, elementId: string) {
    return this.applyAtomic((document) => convertVectorLiveShapeToPath(document, layerId, elementId));
  }

  deletePaths(layerId: LayerId, pathIds: readonly string[]) {
    return this.applyAtomic((document) => deleteVectorPaths(document, layerId, pathIds));
  }

  /** Applies type-preserving element edits across vector layers atomically. */
  editElements(edits: readonly VectorElementEdit[]) {
    if (edits.length === 0) return false;
    const addressed = new Set<string>();
    for (const { layerId, elementId } of edits) {
      const key = `${layerId}\0${elementId}`;
      if (addressed.has(key)) throw new Error(`Duplicate vector element edit ${layerId}/${elementId}.`);
      addressed.add(key);
    }

    const openingDocument = this.resolveDependencies().getDocument();
    if (!openingDocument || edits.some(({ layerId, elementId }) => {
      const layer = findDocumentLayer(openingDocument, layerId);
      return layer?.type !== 'vector'
        || layerIsLocked(layer, 'pixels')
        || !layer.elements.some((element) => element.id === elementId);
    })) return false;

    return this.applyAtomic((openingDocument) => {
      let document = openingDocument;
      for (const change of edits) {
        const layer = findDocumentLayer(document, change.layerId);
        if (layer?.type !== 'vector') return openingDocument;
        const element = layer.elements.find(({ id }) => id === change.elementId);
        if (!element) return openingDocument;
        const edited = change.edit(element);
        if (edited && edited.type !== element.type) {
          throw new Error(`Vector element ${element.id} cannot change type implicitly.`);
        }
        document = edited
          ? replaceVectorElement(document, change.layerId, edited)
          : deleteVectorElements(document, change.layerId, [change.elementId]);
      }
      return document;
    });
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
        || !layer.elements.some((element) => element.type === 'path' && element.id === pathId);
    })) return false;

    return this.applyAtomic((openingDocument) => {
      let document = openingDocument;
      for (const change of edits) {
        const layer = findDocumentLayer(document, change.layerId);
        // The complete address set was validated above. These guards only
        // protect the transaction from an edit that unexpectedly invalidates
        // a later target.
        if (layer?.type !== 'vector') return openingDocument;
        const path = layer.elements.find(
          (element): element is VectorPath => element.type === 'path' && element.id === change.pathId
        );
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
  beginElementCreation<TElement extends VectorElement>(
    element: TElement,
    name = 'Shape'
  ): VectorElementCreationPlacement<TElement> | null {
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
      ? appendVectorElement(beforeDocument, activeLayer.id, element)
      : createVectorLayer(beforeDocument, [element], name);
    const layerId = canAppendToActive
      ? activeLayer.id
      : previewDocument.activeLayerId;
    if (!layerId) return null;

    // Tool input arrives in document space. Persist the inverse layer mapping
    // on the element so nested/transformed vector layers do not reinterpret
    // new geometry as layer-local pixels. The effective element transform
    // remains the transform supplied by the caller.
    const layerToDocument = requireSceneTransform(
      buildSceneTransformIndex(previewDocument),
      layerId
    ).localToDocument;
    const documentToLayer = invertMatrix(layerToDocument);
    const documentToElement = invertMatrix(element.transform);
    if (!documentToLayer || !documentToElement) return null;
    const storedElement = cloneVectorElement(element) as TElement;
    storedElement.transform = multiplyMatrices(documentToLayer, element.transform);
    previewDocument = replaceVectorElement(previewDocument, layerId, storedElement);

    this.activeCreation = {
      documentId: beforeDocument.id,
      layerId,
      elementId: element.id,
      beforeDocument
    };
    dependencies.applyDocumentSnapshot(previewDocument);
    return {
      layerId,
      element: cloneVectorElement(storedElement) as TElement,
      elementToDocument: { ...element.transform },
      documentToElement: { ...documentToElement },
      documentToLayer: { ...documentToLayer }
    };
  }

  previewElementCreation(element: VectorElement) {
    const active = this.activeCreation;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || document?.id !== active.documentId || element.id !== active.elementId) {
      this.activeCreation = null;
      return false;
    }
    const layer = findDocumentLayer(document, active.layerId);
    if (
      layer?.type !== 'vector'
      || !layer.elements.some((candidate) =>
        candidate.id === active.elementId && candidate.type === element.type)
    ) {
      this.activeCreation = null;
      return false;
    }
    const next = replaceVectorElement(document, active.layerId, element);
    if (next === document) return false;
    dependencies.applyDocumentSnapshot(next);
    return true;
  }

  commitElementCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== active.documentId) return false;
    dependencies.pushDocumentHistory(active.beforeDocument, document);
    return true;
  }

  cancelElementCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    const dependencies = this.resolveDependencies();
    if (dependencies.getDocument()?.id !== active.documentId) return false;
    dependencies.applyDocumentSnapshot(active.beforeDocument);
    return true;
  }

  beginPathCreation(path: VectorPath, name = 'Shape'): VectorPathCreationPlacement | null {
    const placement = this.beginElementCreation(path, name);
    return placement ? {
      layerId: placement.layerId,
      path: placement.element,
      pathToDocument: placement.elementToDocument,
      documentToPath: placement.documentToElement
    } : null;
  }

  previewPathCreation(path: VectorPath) {
    return this.previewElementCreation(path);
  }

  commitPathCreation() {
    return this.commitElementCreation();
  }

  cancelPathCreation() {
    return this.cancelElementCreation();
  }

  beginPathMutation(layerId: LayerId, pathId: string) {
    this.cancelActiveInteraction();
    const document = this.resolveDependencies().getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    const path = layer?.type === 'vector'
      ? layer.elements.find(
          (element): element is VectorPath => element.type === 'path' && element.id === pathId
        )
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

  beginElementMutation(layerId: LayerId, elementId: string) {
    return this.beginElementMutations([{ layerId, elementId }]);
  }

  beginElementMutations(addresses: ReadonlyArray<{ layerId: LayerId; elementId: string }>) {
    this.cancelActiveInteraction();
    const document = this.resolveDependencies().getDocument();
    if (!document || addresses.length === 0) return false;
    const unique = new Set<string>();
    const elements: ActiveElementMutation['elements'] = [];
    for (const address of addresses) {
      const key = `${address.layerId}\0${address.elementId}`;
      if (unique.has(key)) return false;
      unique.add(key);
      const layer = findDocumentLayer(document, address.layerId);
      const element = layer?.type === 'vector'
        ? layer.elements.find(({ id }) => id === address.elementId)
        : null;
      if (!element || !layer || layerIsLocked(layer, 'pixels')) return false;
      elements.push({ ...address, openingElement: cloneVectorElement(element) });
    }
    this.activeElementMutation = {
      documentId: document.id,
      beforeDocument: document,
      elements,
      changed: false
    };
    return true;
  }

  previewElementMutation(mutate: (openingSnapshot: VectorElement) => VectorElement) {
    return this.previewElementMutations(({ openingElement }) => mutate(openingElement));
  }

  previewElementMutations(mutate: (target: {
    layerId: LayerId;
    elementId: string;
    openingElement: VectorElement;
  }) => VectorElement) {
    const active = this.activeElementMutation;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || document?.id !== active.documentId) {
      this.activeElementMutation = null;
      return false;
    }
    let next = document;
    for (const target of active.elements) {
      const layer = findDocumentLayer(next, target.layerId);
      const current = layer?.type === 'vector'
        ? layer.elements.find(({ id }) => id === target.elementId)
        : null;
      if (!current) {
        this.activeElementMutation = null;
        return false;
      }
      const preview = mutate({
        ...target,
        openingElement: cloneVectorElement(target.openingElement)
      });
      if (preview.id !== target.elementId || preview.type !== target.openingElement.type) {
        throw new Error('Interactive vector mutation cannot change element identity or type.');
      }
      next = replaceVectorElement(next, target.layerId, preview);
    }
    dependencies.applyDocumentSnapshot(next);
    active.changed = true;
    return true;
  }

  commitElementMutation() {
    const active = this.activeElementMutation;
    if (!active) return false;
    this.activeElementMutation = null;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== active.documentId) return false;
    if (!active.changed) {
      dependencies.applyDocumentSnapshot(active.beforeDocument);
      return false;
    }
    dependencies.pushDocumentHistory(active.beforeDocument, document);
    return true;
  }

  cancelElementMutation() {
    const active = this.activeElementMutation;
    if (!active) return false;
    this.activeElementMutation = null;
    const dependencies = this.resolveDependencies();
    if (dependencies.getDocument()?.id !== active.documentId) return false;
    dependencies.applyDocumentSnapshot(active.beforeDocument);
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
    if (
      layer?.type !== 'vector'
      || !layer.elements.some((element) => element.type === 'path' && element.id === active.pathId)
    ) {
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
    const interactionPathId = interaction
      ? 'pathId' in interaction ? interaction.pathId : interaction.elementId
      : null;
    if (!interaction || connectedPath.id !== interactionPathId) return false;
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
      || !activeLayer.elements.some((element) => element.type === 'path' && element.id === interactionPathId)
      || !targetLayer.elements.some((element) => element.type === 'path' && element.id === targetPathId)
    ) return false;

    if (this.activeMutation) {
      this.activeMutation.session.update(() => connectedPath);
    }
    let next = replaceVectorPath(document, interaction.layerId, connectedPath);
    if (targetLayerId !== interaction.layerId || targetPathId !== interactionPathId) {
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
    if (this.activeMutation || this.activeElementMutation || this.activeCreation) return false;
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
    if (this.activeElementMutation) return this.cancelElementMutation();
    return false;
  }
}
