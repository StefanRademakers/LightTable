import {
  invertMatrix,
  transformPoint,
  translateVectorElement,
  type Vec2
} from '@lighttable/vector-core';
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
  vectorElementsTopmostFirst
} from './vectorSceneQueries';

export interface VectorElementSelectionDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface VectorElementSelectionPointerOptions {
  radius: number;
  additive?: boolean;
}

interface SelectedElementTransform {
  readonly layerId: LayerId;
  readonly elementId: string;
  readonly documentToLayer: NonNullable<ReturnType<typeof invertMatrix>>;
}

interface ActiveElementDrag {
  readonly documentId: ImageDocument['id'];
  readonly startDocument: Vec2;
  readonly targets: readonly SelectedElementTransform[];
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
    const current = cloneVectorEditorSelection(this.dependencies.getSelection());
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

    const resolved = vectorElementsTopmostFirst(document);
    const targets = elements.flatMap((selected) => {
      const entry = resolved.find(
        (candidate) => candidate.layerId === selected.layerId
          && candidate.elementId === selected.elementId
      );
      const documentToLayer = entry ? invertMatrix(entry.layerToDocument) : null;
      return documentToLayer ? [{ ...selected, documentToLayer }] : [];
    });
    if (targets.length !== elements.length || !this.documents.beginElementMutations(elements)) {
      return true;
    }
    this.drag = {
      documentId: document.id,
      startDocument: { ...documentPoint },
      targets,
      moved: false
    };
    return true;
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
    return this.documents.previewElementMutations((target) => {
      const mapping = drag.targets.find(
        (candidate) => candidate.layerId === target.layerId
          && candidate.elementId === target.elementId
      );
      return mapping
        ? translateVectorElement(target.openingElement, localDelta(mapping.documentToLayer, documentDelta))
        : target.openingElement;
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
}
