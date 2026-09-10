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
import { replaceVectorElement } from '../../editor/document/documentCommands';
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
import type { VectorTransformPreviewBinding } from './VectorTransformPreviewBinding';
import { VectorGradientHandleDragController } from './VectorGradientHandleDragController';

export interface VectorElementSelectionDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
  captureTransformPreview(): VectorTransformPreviewBinding | null;
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
  lastDocument: Vec2;
  readonly targets: readonly SelectedElementTransform[];
  readonly scale: VectorElementScaleGesture | null;
  readonly rotation: VectorElementRotationGesture | null;
  readonly preserveAspect: boolean;
  readonly elementPreview: {
    readonly binding: VectorTransformPreviewBinding;
    readonly sourceLayers: readonly VectorLayer[];
    elements: readonly { readonly layerId: LayerId; readonly element: VectorElement }[];
    revision: number;
  };
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

/** Whole-element vector selection; pointer-up is the sole canonical commit. */
export class VectorElementSelectionToolController {
  private drag: ActiveElementDrag | null = null;
  private readonly gradientDrag: VectorGradientHandleDragController;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly dependencies: VectorElementSelectionDependencies
  ) {
    this.gradientDrag = new VectorGradientHandleDragController(
      documents,
      dependencies.getDocument
    );
  }

  pointerDown(documentPoint: Vec2, options: VectorElementSelectionPointerOptions) {
    this.cancel();
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const current = cloneVectorEditorSelection(this.dependencies.getSelection());
    if (this.gradientDrag.begin(document, current, documentPoint, options.radius)) return true;
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
    if (this.gradientDrag.active) return this.gradientDrag.move(documentPoint);
    const drag = this.drag;
    if (!drag || this.dependencies.getDocument()?.id !== drag.documentId) {
      if (drag) this.cancel();
      return false;
    }
    if (!drag.elementPreview.binding.isCurrent()) {
      this.cancel();
      return false;
    }
    if (documentPoint.x === drag.lastDocument.x && documentPoint.y === drag.lastDocument.y) {
      return true;
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
            element.transformRevision + drag.elementPreview.revision
          );
          preview.styleRevision = Math.max(
            preview.styleRevision,
            element.styleRevision + drag.elementPreview.revision
          );
          return preview;
        })
      }));
    if (!drag.elementPreview.binding.setElements(previewLayers, documentOperation)) {
      this.cancel();
      return false;
    }
    drag.elementPreview.elements = elements;
    drag.lastDocument = { ...documentPoint };
    return true;
  }

  pointerUp(documentPoint: Vec2) {
    if (this.gradientDrag.active) return this.gradientDrag.finish(documentPoint);
    const drag = this.drag;
    if (!drag) return false;
    const accepted = this.pointerMove(documentPoint);
    if (!accepted || this.drag !== drag) return false;
    if (!drag.moved) {
      this.drag = null;
      this.documents.cancelDocumentMutation();
      return false;
    }
    if (!drag.elementPreview.binding.isCurrent()
      || !this.documents.stageDocumentMutation((document) => drag.elementPreview.elements.reduce(
        (next, { layerId, element }) => replaceVectorElement(next, layerId, element),
        document
      ))
      || !drag.elementPreview.binding.isCurrent()) {
      this.cancel();
      return false;
    }
    this.drag = null;
    return this.documents.commitDocumentMutation();
  }

  cancel() {
    const active = this.drag !== null || this.gradientDrag.active;
    const ownsPreview = this.drag !== null;
    this.drag = null;
    const gradientCanceled = this.gradientDrag.cancel();
    return (ownsPreview
      ? this.documents.cancelDocumentMutation()
      : this.documents.cancelElementMutation()) || gradientCanceled || active;
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
    const previewBinding = this.dependencies.captureTransformPreview();
    const boundPreview = previewBinding?.document === document && previewBinding.isCurrent()
      ? previewBinding
      : null;
    if (!boundPreview) return true;
    const sourceLayers = [...new Map(targets.map((target) => {
      const layer = findDocumentLayer(document, target.layerId);
      return [target.layerId, layer?.type === 'vector' ? layer : null] as const;
    })).values()].filter((layer): layer is VectorLayer => layer !== null);
    if (sourceLayers.length === 0 || !this.documents.beginDocumentMutation(
        `vector:element-transform:${targets.map(({ elementId }) => elementId).join(',')}`,
        { label: 'Free Transform', type: 'vector.transform' },
        () => boundPreview.clearElements()
      ) || !boundPreview.setElements(sourceLayers, translationMatrix(0, 0))) {
      this.documents.cancelDocumentMutation();
      return true;
    }
    this.drag = {
      documentId: document.id,
      startDocument: { ...documentPoint },
      lastDocument: { ...documentPoint },
      targets,
      scale: options.scale,
      rotation: options.rotation,
      preserveAspect: options.preserveAspect,
      elementPreview: {
        binding: boundPreview,
        sourceLayers,
        elements: targets.map(({ layerId, openingElement }) => ({
          layerId,
          element: cloneVectorElement(openingElement)
        })),
        revision: 0
      },
      moved: false
    };
    return true;
  }

}
