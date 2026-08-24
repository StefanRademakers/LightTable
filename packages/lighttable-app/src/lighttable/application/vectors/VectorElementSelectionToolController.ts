import {
  cloneVectorElement,
  invertMatrix,
  multiplyMatrices,
  transformPoint,
  transformVectorElement,
  transformVectorElementDocumentPaint,
  translationMatrix,
  translateVectorElement,
  type AffineMatrix,
  type Vec2,
  type VectorElement
} from '@lighttable/vector-core';
import {
  buildVectorSelectionFrame,
  hitTestVectorSelectionFrameHandle,
  hitTestVectorSelectionFrameRotation
} from '@lighttable/vector-rendering';
import type { ImageDocument, LayerId, VectorLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  cloneVectorEditorSelection,
  createVectorEditorSelection,
  type VectorEditorSelection,
  type VectorElementSelectionReference
} from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import {
  hitTestVectorElementDocument,
  vectorElementsDocumentBounds,
  vectorElementsTopmostFirst
} from './vectorSceneQueries';
import {
  beginVectorElementScaleGesture,
  beginVectorElementRotationGesture,
  vectorElementRotationOperation,
  vectorElementScaleOperation,
  type VectorElementRotationGesture,
  type VectorElementScaleGesture
} from './vectorElementTransformGesture';
import { resolveVectorGradientGeometry } from './vectorGradientGeometry';

export interface VectorElementSelectionDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
  setLayerTransformPreview?(
    layer: VectorLayer,
    matrix: AffineMatrix | null,
    documentOperation?: AffineMatrix | null
  ): boolean;
  commitLayerTransformPreview?(
    before: ImageDocument,
    layerId: LayerId,
    matrix: AffineMatrix,
    documentOperation: AffineMatrix
  ): boolean;
  setElementTransformPreview?(
    layers: readonly VectorLayer[],
    documentOperation: AffineMatrix | null
  ): boolean;
  commitElementTransformPreview?(
    before: ImageDocument,
    elements: readonly { readonly layerId: LayerId; readonly element: VectorElement }[]
  ): boolean;
}

export interface VectorElementSelectionPointerOptions {
  radius: number;
  additive?: boolean;
  preserveAspect?: boolean;
}

interface SelectedElementTransform {
  readonly layerId: LayerId;
  readonly elementId: string;
  readonly documentToLayer: NonNullable<ReturnType<typeof invertMatrix>>;
  readonly layerToDocument: AffineMatrix;
  readonly openingElement: VectorElement;
}

interface ActiveElementDrag {
  readonly documentId: ImageDocument['id'];
  readonly startDocument: Vec2;
  readonly targets: readonly SelectedElementTransform[];
  readonly scale: VectorElementScaleGesture | null;
  readonly rotation: VectorElementRotationGesture | null;
  readonly preserveAspect: boolean;
  readonly layerPreview: {
    readonly before: ImageDocument;
    readonly layer: VectorLayer;
    readonly openingTransform: AffineMatrix;
    matrix: AffineMatrix;
    documentOperation: AffineMatrix;
  } | null;
  readonly elementPreview: {
    readonly before: ImageDocument;
    readonly sourceLayers: readonly VectorLayer[];
    elements: readonly { readonly layerId: LayerId; readonly element: VectorElement }[];
    revision: number;
  } | null;
  moved: boolean;
}

interface ActiveGradientDrag {
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly elementId: string;
  readonly handle: 'start' | 'end';
  readonly documentToPaintParent: NonNullable<ReturnType<typeof invertMatrix>>;
  readonly openingStart: Vec2;
  readonly openingEnd: Vec2;
  moved: boolean;
}

const sameElement = (
  left: VectorElementSelectionReference,
  right: VectorElementSelectionReference
) => left.layerId === right.layerId && left.elementId === right.elementId;

const elementOnlySelection = (
  elements: readonly VectorElementSelectionReference[]
): VectorEditorSelection => ({
  elements: elements.map((reference) => ({ ...reference })),
  paths: [],
  anchors: [],
  active: null
});

const localDelta = (
  documentToLayer: SelectedElementTransform['documentToLayer'],
  delta: Vec2
): Vec2 => {
  const origin = transformPoint(documentToLayer, { x: 0, y: 0 });
  const endpoint = transformPoint(documentToLayer, delta);
  return { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
};

/**
 * Whole-element selection and translation for both paths and live shapes.
 *
 * Geometry remains authoritative: dragging changes only the element transform,
 * never realizes a live shape or bakes path coordinates. A complete gesture is
 * one document transaction regardless of how many selected elements move.
 */
export class VectorElementSelectionToolController {
  private drag: ActiveElementDrag | null = null;
  private gradientDrag: ActiveGradientDrag | null = null;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly dependencies: VectorElementSelectionDependencies
  ) {}

  pointerDown(documentPoint: Vec2, options: VectorElementSelectionPointerOptions) {
    this.cancel();
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const current = cloneVectorEditorSelection(this.dependencies.getSelection());
    const gradient = this.gradientHandleAt(document, current, documentPoint, options.radius);
    if (gradient && this.documents.beginElementMutations([gradient])) {
      this.gradientDrag = {
        documentId: document.id,
        ...gradient,
        moved: false
      };
      return true;
    }
    const currentBounds = vectorElementsDocumentBounds(document, current.elements);
    const currentFrame = currentBounds
      ? buildVectorSelectionFrame(currentBounds, { resourceKey: 'interaction-frame' })
      : null;
    const scaleHandle = currentFrame
      ? hitTestVectorSelectionFrameHandle(currentFrame, documentPoint, options.radius)
      : null;
    if (scaleHandle && currentBounds && current.elements.length > 0) {
      this.dependencies.setSelection(elementOnlySelection(current.elements));
      return this.beginDrag(document, current.elements, documentPoint, {
        scale: beginVectorElementScaleGesture(currentBounds, scaleHandle.kind),
        rotation: null,
        preserveAspect: options.preserveAspect ?? false
      });
    }
    if (
      currentFrame
      && currentBounds
      && current.elements.length > 0
      && hitTestVectorSelectionFrameRotation(currentFrame, documentPoint, options.radius)
    ) {
      this.dependencies.setSelection(elementOnlySelection(current.elements));
      return this.beginDrag(document, current.elements, documentPoint, {
        scale: null,
        rotation: beginVectorElementRotationGesture(currentBounds, documentPoint),
        preserveAspect: options.preserveAspect ?? false
      });
    }
    const hit = hitTestVectorElementDocument(document, {
      documentPoint,
      radius: options.radius,
      includeFill: true,
      includeHandles: false
    });
    if (!hit) {
      if (!options.additive) this.dependencies.setSelection(createVectorEditorSelection());
      return true;
    }

    const reference: VectorElementSelectionReference = {
      layerId: hit.layerId,
      elementId: hit.elementId
    };
    const alreadySelected = current.elements.some((item) => sameElement(item, reference));
    if (options.additive && alreadySelected) {
      this.dependencies.setSelection(elementOnlySelection(
        current.elements.filter((item) => !sameElement(item, reference))
      ));
      return true;
    }

    const elements = options.additive
      ? [...current.elements, reference]
      : alreadySelected
        ? current.elements
        : [reference];
    this.dependencies.setSelection(elementOnlySelection(elements));

    return this.beginDrag(document, elements, documentPoint, {
      scale: null,
      rotation: null,
      preserveAspect: false
    });
  }

  pointerMove(documentPoint: Vec2) {
    if (this.gradientDrag) return this.moveGradientHandle(documentPoint);
    const drag = this.drag;
    if (!drag || this.dependencies.getDocument()?.id !== drag.documentId) {
      if (drag) this.cancel();
      return false;
    }
    const documentDelta = {
      x: documentPoint.x - drag.startDocument.x,
      y: documentPoint.y - drag.startDocument.y
    };
    const moved = documentDelta.x !== 0 || documentDelta.y !== 0;
    if (!moved && !drag.moved) return true;
    drag.moved = moved;
    const documentOperation = drag.scale
      ? vectorElementScaleOperation(drag.scale, documentPoint, drag.preserveAspect)
      : drag.rotation
        ? vectorElementRotationOperation(drag.rotation, documentPoint, drag.preserveAspect)
        : translationMatrix(documentDelta.x, documentDelta.y);
    if (drag.layerPreview) {
      const target = drag.targets[0]!;
      const layerToParentInverse = invertMatrix(drag.layerPreview.openingTransform);
      if (!layerToParentInverse) return false;
      const documentToParent = invertMatrix(multiplyMatrices(
        target.layerToDocument,
        layerToParentInverse
      ));
      if (!documentToParent) return false;
      const matrix = multiplyMatrices(
        documentToParent,
        multiplyMatrices(documentOperation, target.layerToDocument)
      );
      if (!this.dependencies.setLayerTransformPreview?.(
        drag.layerPreview.layer, matrix, documentOperation
      )) {
        return false;
      }
      drag.layerPreview.matrix = matrix;
      drag.layerPreview.documentOperation = documentOperation;
      return true;
    }
    const transformTarget = (mapping: SelectedElementTransform) => {
      if (!drag.scale && !drag.rotation) {
        return transformVectorElementDocumentPaint(translateVectorElement(
          mapping.openingElement,
          localDelta(mapping.documentToLayer, documentDelta)
        ), documentOperation);
      }
      const layerOperation = multiplyMatrices(
        mapping.documentToLayer,
        multiplyMatrices(documentOperation, mapping.layerToDocument)
      );
      return transformVectorElementDocumentPaint(
        transformVectorElement(mapping.openingElement, layerOperation),
        documentOperation
      );
    };
    if (drag.elementPreview) {
      drag.elementPreview.revision += 1;
      const elements = drag.targets.map((mapping) => ({
        layerId: mapping.layerId,
        element: transformTarget(mapping)
      }));
      const byAddress = new Map(elements.map(({ layerId, element }) => [
        `${layerId}\0${element.id}`,
        element
      ]));
      const previewLayers = drag.elementPreview.sourceLayers.map((layer) => ({
        ...layer,
        elements: layer.elements.map((element) => {
          const transformed = byAddress.get(`${layer.id}\0${element.id}`);
          if (!transformed) return element;
          const preview = cloneVectorElement(transformed);
          preview.transformRevision = Math.max(
            preview.transformRevision,
            element.transformRevision + drag.elementPreview!.revision
          );
          preview.styleRevision = Math.max(
            preview.styleRevision,
            element.styleRevision + drag.elementPreview!.revision
          );
          return preview;
        })
      }));
      if (!this.dependencies.setElementTransformPreview?.(previewLayers, documentOperation)) {
        return false;
      }
      drag.elementPreview.elements = elements;
      return true;
    }
    return this.documents.previewElementMutations((target) => {
      const mapping = drag.targets.find(
        (candidate) => candidate.layerId === target.layerId
          && candidate.elementId === target.elementId
      );
      if (!mapping) return target.openingElement;
      if (!drag.scale && !drag.rotation) {
        return transformVectorElementDocumentPaint(translateVectorElement(
          target.openingElement,
          localDelta(mapping.documentToLayer, documentDelta)
        ), documentOperation);
      }
      const layerOperation = multiplyMatrices(
        mapping.documentToLayer,
        multiplyMatrices(documentOperation, mapping.layerToDocument)
      );
      return transformVectorElementDocumentPaint(
        transformVectorElement(target.openingElement, layerOperation),
        documentOperation
      );
    });
  }

  pointerUp(documentPoint: Vec2) {
    if (this.gradientDrag) {
      const drag = this.gradientDrag;
      this.moveGradientHandle(documentPoint);
      this.gradientDrag = null;
      if (!drag.moved) {
        this.documents.cancelElementMutation();
        return false;
      }
      return this.documents.commitElementMutation();
    }
    const drag = this.drag;
    if (!drag) return false;
    this.pointerMove(documentPoint);
    this.drag = null;
    if (drag.layerPreview) {
      this.dependencies.setLayerTransformPreview?.(drag.layerPreview.layer, null, null);
      if (!drag.moved) return false;
      return this.dependencies.commitLayerTransformPreview?.(
        drag.layerPreview.before,
        drag.layerPreview.layer.id,
        drag.layerPreview.matrix,
        drag.layerPreview.documentOperation
      ) ?? false;
    }
    if (drag.elementPreview) {
      this.dependencies.setElementTransformPreview?.([], null);
      if (!drag.moved) return false;
      return this.dependencies.commitElementTransformPreview?.(
        drag.elementPreview.before,
        drag.elementPreview.elements
      ) ?? false;
    }
    if (!drag.moved) {
      this.documents.cancelElementMutation();
      return false;
    }
    return this.documents.commitElementMutation();
  }

  cancel() {
    const active = this.drag !== null || this.gradientDrag !== null;
    if (this.drag?.layerPreview) {
      this.dependencies.setLayerTransformPreview?.(this.drag.layerPreview.layer, null, null);
    }
    if (this.drag?.elementPreview) {
      this.dependencies.setElementTransformPreview?.([], null);
    }
    this.drag = null;
    this.gradientDrag = null;
    return this.documents.cancelElementMutation() || active;
  }

  clearSelection() {
    this.cancel();
    this.dependencies.setSelection(createVectorEditorSelection());
  }

  dispose() {
    this.cancel();
  }

  private beginDrag(
    document: ImageDocument,
    elements: readonly VectorElementSelectionReference[],
    documentPoint: Vec2,
    options: {
      scale: VectorElementScaleGesture | null;
      rotation: VectorElementRotationGesture | null;
      preserveAspect: boolean;
    }
  ) {
    const resolved = vectorElementsTopmostFirst(document);
    const targets = elements.flatMap((selected) => {
      const entry = resolved.find(
        (candidate) => candidate.layerId === selected.layerId
          && candidate.elementId === selected.elementId
      );
      const documentToLayer = entry ? invertMatrix(entry.layerToDocument) : null;
      return entry && documentToLayer
        ? [{
            ...selected,
            documentToLayer,
            layerToDocument: entry.layerToDocument,
            openingElement: cloneVectorElement(entry.element)
          }]
        : [];
    });
    if (targets.length !== elements.length) {
      return true;
    }
    const selectedLayer = elements.length > 0
      && elements.every(({ layerId }) => layerId === elements[0]!.layerId)
      ? findDocumentLayer(document, elements[0]!.layerId)
      : null;
    const selectedElementIds = new Set(elements.map(({ elementId }) => elementId));
    const selectsCompleteLayer = selectedLayer?.type === 'vector'
      && selectedLayer.elements.length === selectedElementIds.size
      && selectedLayer.elements.every(({ id }) => selectedElementIds.has(id));
    // Moving/scaling/rotating every element in one vector layer is exactly a
    // layer transform. Keep that complete operation on the retained semantic
    // preview plane, regardless of how many logical SVG objects the layer
    // contains. Pointer-up remains the sole canonical/history publication and
    // setLayerTransform carries document-space paints and linked masks with it.
    const layerPreview = selectsCompleteLayer
      && selectedLayer?.type === 'vector'
      && this.dependencies.setLayerTransformPreview
      && this.dependencies.commitLayerTransformPreview
      && this.dependencies.setLayerTransformPreview(
        selectedLayer, selectedLayer.transform, translationMatrix(0, 0)
      )
      ? {
          before: document,
          layer: selectedLayer,
          openingTransform: { ...selectedLayer.transform },
          matrix: { ...selectedLayer.transform },
          documentOperation: translationMatrix(0, 0)
        }
      : null;
    const sourceLayers = [...new Map(targets.map((target) => {
      const layer = findDocumentLayer(document, target.layerId);
      return [target.layerId, layer?.type === 'vector' ? layer : null] as const;
    })).values()].filter((layer): layer is VectorLayer => layer !== null);
    const elementPreview = !layerPreview
      && sourceLayers.length > 0
      && this.dependencies.setElementTransformPreview
      && this.dependencies.commitElementTransformPreview
      && this.dependencies.setElementTransformPreview(sourceLayers, translationMatrix(0, 0))
      ? {
          before: document,
          sourceLayers,
          elements: targets.map(({ layerId, openingElement }) => ({
            layerId,
            element: cloneVectorElement(openingElement)
          })),
          revision: 0
        }
      : null;
    if (!layerPreview && !elementPreview && !this.documents.beginElementMutations(elements)) return true;
    this.drag = {
      documentId: document.id,
      startDocument: { ...documentPoint },
      targets,
      scale: options.scale,
      rotation: options.rotation,
      preserveAspect: options.preserveAspect,
      layerPreview,
      elementPreview,
      moved: false
    };
    return true;
  }

  private gradientHandleAt(
    document: ImageDocument,
    selection: VectorEditorSelection,
    point: Vec2,
    radius: number
  ): Omit<ActiveGradientDrag, 'documentId' | 'moved'> | null {
    const selected = new Set(selection.elements.map(({ layerId, elementId }) => `${layerId}\0${elementId}`));
    let closest: (Omit<ActiveGradientDrag, 'documentId' | 'moved'> & { distanceSquared: number }) | null = null;
    for (const resolved of vectorElementsTopmostFirst(document)) {
      if (!selected.has(`${resolved.layerId}\0${resolved.elementId}`)) continue;
      const geometry = resolveVectorGradientGeometry(resolved);
      if (!geometry) continue;
      for (const handle of ['start', 'end'] as const) {
        const target = handle === 'start' ? geometry.startInDocument : geometry.endInDocument;
        const distanceSquared = (target.x - point.x) ** 2 + (target.y - point.y) ** 2;
        if (distanceSquared > radius ** 2 || (closest && distanceSquared >= closest.distanceSquared)) continue;
        closest = {
          layerId: resolved.layerId,
          elementId: resolved.elementId,
          handle,
          documentToPaintParent: geometry.documentToPaintParent,
          openingStart: geometry.startInPaintParent,
          openingEnd: geometry.endInPaintParent,
          distanceSquared
        };
      }
    }
    if (!closest) return null;
    const { distanceSquared: _distanceSquared, ...result } = closest;
    return result;
  }

  private moveGradientHandle(documentPoint: Vec2) {
    const drag = this.gradientDrag;
    if (!drag || this.dependencies.getDocument()?.id !== drag.documentId) {
      if (drag) this.cancel();
      return false;
    }
    const position = transformPoint(drag.documentToPaintParent, documentPoint);
    const start = drag.handle === 'start' ? position : drag.openingStart;
    const end = drag.handle === 'end' ? position : drag.openingEnd;
    drag.moved = drag.moved
      || position.x !== (drag.handle === 'start' ? drag.openingStart.x : drag.openingEnd.x)
      || position.y !== (drag.handle === 'start' ? drag.openingStart.y : drag.openingEnd.y);
    return this.documents.previewElementMutations((target) => {
      if (target.layerId !== drag.layerId || target.elementId !== drag.elementId) return target.openingElement;
      const fill = target.openingElement.style.fill;
      if (!fill || !('kind' in fill)) return target.openingElement;
      const next = cloneVectorElement(target.openingElement);
      next.style.fill = {
        ...fill,
        transform: {
          ...fill.transform,
          a: end.x - start.x,
          b: end.y - start.y,
          tx: start.x,
          ty: start.y
        }
      };
      next.styleRevision += 1;
      return next;
    });
  }
}
