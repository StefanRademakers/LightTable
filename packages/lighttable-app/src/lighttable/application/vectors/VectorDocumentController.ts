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
  LayerId,
  VectorLayer
} from '../../editor/document/documentTypes';
import type { BlendMode } from '../../editor/document/blendModes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  buildSceneTransformIndex,
  requireSceneTransform
} from '../../editor/document/sceneTransformGraph';
import type {
  DocumentMutationController,
  DocumentMutationDescription,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

export interface VectorDocumentControllerDependencies {
  getDocument(): ImageDocument | null;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
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
  layerId: LayerId;
  pathId: string;
  transaction: DocumentMutationTransaction;
  session: PathMutationSession;
}

interface ActiveElementMutation {
  transaction: DocumentMutationTransaction;
  elements: Array<{
    layerId: LayerId;
    elementId: string;
    openingElement: VectorElement;
  }>;
  changed: boolean;
}

interface ActiveElementCreation {
  layerId: LayerId;
  elementId: string;
  transaction: DocumentMutationTransaction;
}

interface ActiveDocumentMutation {
  transaction: DocumentMutationTransaction;
}

const sameTransform = (left: AffineMatrix, right: AffineMatrix) => (
  left.a === right.a && left.b === right.b && left.c === right.c
  && left.d === right.d && left.tx === right.tx && left.ty === right.ty
);

const sameElementGeometry = (left: VectorElement, right: VectorElement) => {
  if (left.type !== right.type) return false;
  if (left.type === 'live-shape') {
    return right.type === 'live-shape'
      && JSON.stringify(left.geometry) === JSON.stringify(right.geometry);
  }
  return right.type === 'path'
    && JSON.stringify([left.fillRule, left.subpaths])
      === JSON.stringify([right.fillRule, right.subpaths]);
};

export interface VectorElementCreationTransaction {
  readonly beforeDocument: ImageDocument;
  readonly previewDocument: ImageDocument;
  readonly layerId: LayerId;
  readonly elementId: string;
  commitWith(commit: (before: ImageDocument, after: ImageDocument) => boolean): boolean;
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

export interface VectorElementCreationOptions {
  readonly alwaysCreateLayer?: boolean;
  readonly role?: VectorLayer['role'];
  readonly opacity?: number;
  readonly blendMode?: BlendMode;
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
  private activeDocumentMutation: ActiveDocumentMutation | null = null;

  constructor(
    private readonly resolveDependencies: () => VectorDocumentControllerDependencies
  ) {}

  currentDocument() {
    return this.activeCreation?.transaction.current
      ?? this.activeMutation?.transaction.current
      ?? this.activeElementMutation?.transaction.current
      ?? this.activeDocumentMutation?.transaction.current
      ?? this.resolveDependencies().getDocument();
  }

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
    name = 'Shape',
    options: VectorElementCreationOptions = {}
  ): VectorElementCreationPlacement<TElement> | null {
    this.cancelActiveInteraction();
    const dependencies = this.resolveDependencies();
    const transaction = dependencies.documentMutations.begin(
      `vector:create:${element.id}`,
      { label: 'New Shape Layer', type: 'vector.create' }
    );
    if (!transaction) return null;
    const beforeDocument = transaction.before;

    const activeLayer = beforeDocument.activeLayerId
      ? findDocumentLayer(beforeDocument, beforeDocument.activeLayerId)
      : null;
    const canAppendToActive = !options.alwaysCreateLayer
      && activeLayer?.type === 'vector'
      && !layerIsLocked(activeLayer, 'pixels');
    let previewDocument = canAppendToActive
      ? appendVectorElement(beforeDocument, activeLayer.id, element)
      : createVectorLayer(
          beforeDocument,
          [element],
          name,
          beforeDocument.activeLayerId ?? undefined,
          options.role,
          {
            opacity: options.opacity ?? 1,
            blendMode: options.blendMode ?? 'normal'
          }
        );
    const layerId = canAppendToActive
      ? activeLayer.id
      : previewDocument.activeLayerId;
    if (!layerId) {
      transaction.cancel();
      return null;
    }

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
    if (!documentToLayer || !documentToElement) {
      transaction.cancel();
      return null;
    }
    const storedElement = cloneVectorElement(element) as TElement;
    storedElement.transform = multiplyMatrices(documentToLayer, element.transform);
    previewDocument = replaceVectorElement(previewDocument, layerId, storedElement);

    this.activeCreation = {
      layerId,
      elementId: element.id,
      transaction
    };
    if (!transaction.change(() => previewDocument)) {
      this.activeCreation = null;
      transaction.cancel();
      return null;
    }
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
    if (!active || !active.transaction.active || element.id !== active.elementId) {
      this.activeCreation = null;
      active?.transaction.cancel();
      return false;
    }
    const document = active.transaction.current;
    const layer = findDocumentLayer(document, active.layerId);
    if (
      layer?.type !== 'vector'
      || !layer.elements.some((candidate) =>
        candidate.id === active.elementId && candidate.type === element.type)
    ) {
      this.activeCreation = null;
      active.transaction.cancel();
      return false;
    }
    const next = replaceVectorElement(document, active.layerId, element);
    if (next === document) return false;
    return active.transaction.change(() => next);
  }

  commitElementCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    return active.transaction.commit();
  }

  /** Releases a complete preview so a host can atomically bake it to pixels. */
  releaseElementCreation(): VectorElementCreationTransaction | null {
    const active = this.activeCreation;
    if (!active) return null;
    this.activeCreation = null;
    if (!active.transaction.active) {
      return null;
    }
    return {
      beforeDocument: active.transaction.before,
      previewDocument: active.transaction.current,
      layerId: active.layerId,
      elementId: active.elementId,
      commitWith: (commit) => active.transaction.commitWith(commit)
    };
  }

  cancelElementCreation() {
    const active = this.activeCreation;
    if (!active) return false;
    this.activeCreation = null;
    return active.transaction.cancel();
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
    const transaction = this.resolveDependencies().documentMutations.begin(
      `vector:path:${layerId}:${pathId}`,
      { label: 'Edit Path', type: 'vector.path.edit' }
    );
    if (!transaction) return false;
    const document = transaction.before;
    const layer = findDocumentLayer(document, layerId);
    const path = layer?.type === 'vector'
      ? layer.elements.find(
          (element): element is VectorPath => element.type === 'path' && element.id === pathId
        )
      : null;
    if (!path || !layer || layerIsLocked(layer, 'pixels')) {
      transaction.cancel();
      return false;
    }
    this.activeMutation = {
      layerId,
      pathId,
      transaction,
      session: new PathMutationSession(path)
    };
    return true;
  }

  beginElementMutation(layerId: LayerId, elementId: string) {
    return this.beginElementMutations([{ layerId, elementId }]);
  }

  beginElementMutations(addresses: ReadonlyArray<{ layerId: LayerId; elementId: string }>) {
    this.cancelActiveInteraction();
    if (addresses.length === 0) return false;
    const transaction = this.resolveDependencies().documentMutations.begin(
      `vector:elements:${addresses.map(({ layerId, elementId }) => `${layerId}/${elementId}`).join(',')}`,
      { label: 'Edit Shape', type: 'vector.edit' }
    );
    if (!transaction) return false;
    const document = transaction.before;
    const unique = new Set<string>();
    const elements: ActiveElementMutation['elements'] = [];
    for (const address of addresses) {
      const key = `${address.layerId}\0${address.elementId}`;
      if (unique.has(key)) {
        transaction.cancel();
        return false;
      }
      unique.add(key);
      const layer = findDocumentLayer(document, address.layerId);
      const element = layer?.type === 'vector'
        ? layer.elements.find(({ id }) => id === address.elementId)
        : null;
      if (!element || !layer || layerIsLocked(layer, 'pixels')) {
        transaction.cancel();
        return false;
      }
      elements.push({ ...address, openingElement: cloneVectorElement(element) });
    }
    this.activeElementMutation = {
      transaction,
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
    if (!active || !active.transaction.active) {
      this.activeElementMutation = null;
      active?.transaction.cancel();
      return false;
    }
    const document = active.transaction.current;
    let next = document;
    for (const target of active.elements) {
      const layer = findDocumentLayer(next, target.layerId);
      const current = layer?.type === 'vector'
        ? layer.elements.find(({ id }) => id === target.elementId)
        : null;
      if (!current) {
        this.activeElementMutation = null;
        active.transaction.cancel();
        return false;
      }
      const preview = mutate({
        ...target,
        openingElement: cloneVectorElement(target.openingElement)
      });
      if (preview.id !== target.elementId || preview.type !== target.openingElement.type) {
        throw new Error('Interactive vector mutation cannot change element identity or type.');
      }
      // Gesture callbacks intentionally derive every preview from the stable
      // opening element so transforms never accumulate floating-point drift.
      // Their factory revision is therefore also stable (for example every
      // pointer move reports transform revision 1). Retained renderers need a
      // monotonic revision for each distinct preview or they correctly reuse
      // stale pixels while the interaction cage continues moving.
      const revisioned = cloneVectorElement(preview);
      if (preview.geometryRevision !== target.openingElement.geometryRevision) {
        revisioned.geometryRevision = sameElementGeometry(preview, current)
          ? current.geometryRevision
          : Math.max(preview.geometryRevision, current.geometryRevision + 1);
      }
      if (preview.transformRevision !== target.openingElement.transformRevision) {
        revisioned.transformRevision = sameTransform(preview.transform, current.transform)
          ? current.transformRevision
          : Math.max(preview.transformRevision, current.transformRevision + 1);
      }
      if (preview.styleRevision !== target.openingElement.styleRevision) {
        revisioned.styleRevision = JSON.stringify(preview.style) === JSON.stringify(current.style)
          ? current.styleRevision
          : Math.max(preview.styleRevision, current.styleRevision + 1);
      }
      next = replaceVectorElement(next, target.layerId, revisioned);
    }
    active.changed = true;
    return active.transaction.change(() => next);
  }

  commitElementMutation() {
    const active = this.activeElementMutation;
    if (!active) return false;
    this.activeElementMutation = null;
    if (!active.changed) {
      active.transaction.cancel();
      return false;
    }
    return active.transaction.commit();
  }

  cancelElementMutation() {
    const active = this.activeElementMutation;
    if (!active) return false;
    this.activeElementMutation = null;
    return active.transaction.cancel();
  }

  previewPathMutation(mutate: (openingSnapshot: VectorPath) => VectorPath) {
    const active = this.activeMutation;
    if (!active || !active.transaction.active) {
      this.activeMutation = null;
      active?.transaction.cancel();
      return false;
    }
    const document = active.transaction.current;
    const layer = findDocumentLayer(document, active.layerId);
    if (
      layer?.type !== 'vector'
      || !layer.elements.some((element) => element.type === 'path' && element.id === active.pathId)
    ) {
      this.activeMutation = null;
      active.transaction.cancel();
      return false;
    }
    const preview = active.session.update(mutate);
    const next = replaceVectorPath(document, active.layerId, preview);
    if (next === document) return false;
    return active.transaction.change(() => next);
  }

  commitPathMutation() {
    const active = this.activeMutation;
    if (!active) return false;
    this.activeMutation = null;
    const commit = active.session.commit();
    if (!commit) {
      active.transaction.cancel();
      return false;
    }
    return active.transaction.commit();
  }

  cancelPathMutation() {
    const active = this.activeMutation;
    if (!active) return false;
    this.activeMutation = null;
    active.session.cancel();
    return active.transaction.cancel();
  }

  beginDocumentMutation(
    owner: string,
    description: DocumentMutationDescription,
    onClose?: () => void
  ) {
    this.cancelActiveInteraction();
    const transaction = this.resolveDependencies().documentMutations.begin(
      owner,
      description,
      onClose
    );
    if (!transaction) return false;
    this.activeDocumentMutation = { transaction };
    return true;
  }

  stageDocumentMutation(mutate: (document: ImageDocument) => ImageDocument) {
    const active = this.activeDocumentMutation;
    if (!active?.transaction.active) {
      this.activeDocumentMutation = null;
      return false;
    }
    return active.transaction.stage(mutate);
  }

  commitDocumentMutation() {
    const active = this.activeDocumentMutation;
    if (!active) return false;
    this.activeDocumentMutation = null;
    return active.transaction.commit();
  }

  cancelDocumentMutation() {
    const active = this.activeDocumentMutation;
    if (!active) return false;
    this.activeDocumentMutation = null;
    return active.transaction.cancel();
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
    const transaction = interaction.transaction;
    if (!transaction.active) {
      this.activeMutation = null;
      this.activeCreation = null;
      return false;
    }
    const document = transaction.current;
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
    if (this.activeMutation && !this.activeMutation.session.commit()) {
      this.activeMutation = null;
      transaction.cancel();
      return false;
    }
    if (!transaction.change(() => next)) {
      this.activeMutation = null;
      this.activeCreation = null;
      transaction.cancel();
      return false;
    }
    this.activeMutation = null;
    this.activeCreation = null;
    return transaction.commit();
  }

  dispose() {
    this.cancelActiveInteraction();
  }

  private applyAtomic(change: (document: ImageDocument) => ImageDocument) {
    if (this.activeMutation || this.activeElementMutation
      || this.activeCreation || this.activeDocumentMutation) return false;
    return this.resolveDependencies().documentMutations.change(change);
  }

  private cancelActiveInteraction() {
    if (this.activeCreation) return this.cancelPathCreation();
    if (this.activeMutation) return this.cancelPathMutation();
    if (this.activeElementMutation) return this.cancelElementMutation();
    if (this.activeDocumentMutation) return this.cancelDocumentMutation();
    return false;
  }
}
