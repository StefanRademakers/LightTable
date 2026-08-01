import {
  invertMatrix,
  multiplyMatrices,
  transformPoint,
  transformVectorElement,
  translationMatrix,
  translateVectorElement,
  type AffineMatrix,
  type Vec2
} from '@lighttable/vector-core';
import {
  buildVectorSelectionFrame,
  hitTestVectorSelectionFrameHandle
} from '@lighttable/vector-rendering';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
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
  vectorElementScaleOperation,
  type VectorElementScaleGesture
} from './vectorElementTransformGesture';

export interface VectorElementSelectionDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
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
}

interface ActiveElementDrag {
  readonly documentId: ImageDocument['id'];
  readonly startDocument: Vec2;
  readonly targets: readonly SelectedElementTransform[];
  readonly scale: VectorElementScaleGesture | null;
  readonly preserveAspect: boolean;
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

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly dependencies: VectorElementSelectionDependencies
  ) {}

  pointerDown(documentPoint: Vec2, options: VectorElementSelectionPointerOptions) {
    this.cancel();
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const current = cloneVectorEditorSelection(this.dependencies.getSelection());
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
      preserveAspect: false
    });
  }

  pointerMove(documentPoint: Vec2) {
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
      : translationMatrix(documentDelta.x, documentDelta.y);
    return this.documents.previewElementMutations((target) => {
      const mapping = drag.targets.find(
        (candidate) => candidate.layerId === target.layerId
          && candidate.elementId === target.elementId
      );
      if (!mapping) return target.openingElement;
      if (!drag.scale) {
        return translateVectorElement(
          target.openingElement,
          localDelta(mapping.documentToLayer, documentDelta)
        );
      }
      const layerOperation = multiplyMatrices(
        mapping.documentToLayer,
        multiplyMatrices(documentOperation, mapping.layerToDocument)
      );
      return transformVectorElement(target.openingElement, layerOperation);
    });
  }

  pointerUp(documentPoint: Vec2) {
    const drag = this.drag;
    if (!drag) return false;
    this.pointerMove(documentPoint);
    this.drag = null;
    if (!drag.moved) {
      this.documents.cancelElementMutation();
      return false;
    }
    return this.documents.commitElementMutation();
  }

  cancel() {
    const active = this.drag !== null;
    this.drag = null;
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
    options: { scale: VectorElementScaleGesture | null; preserveAspect: boolean }
  ) {
    const resolved = vectorElementsTopmostFirst(document);
    const targets = elements.flatMap((selected) => {
      const entry = resolved.find(
        (candidate) => candidate.layerId === selected.layerId
          && candidate.elementId === selected.elementId
      );
      const documentToLayer = entry ? invertMatrix(entry.layerToDocument) : null;
      return entry && documentToLayer
        ? [{ ...selected, documentToLayer, layerToDocument: entry.layerToDocument }]
        : [];
    });
    if (targets.length !== elements.length || !this.documents.beginElementMutations(elements)) {
      return true;
    }
    this.drag = {
      documentId: document.id,
      startDocument: { ...documentPoint },
      targets,
      scale: options.scale,
      preserveAspect: options.preserveAspect,
      moved: false
    };
    return true;
  }
}
