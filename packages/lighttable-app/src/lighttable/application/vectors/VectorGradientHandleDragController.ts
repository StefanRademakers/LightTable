import {
  cloneVectorElement,
  transformPoint,
  type Vec2
} from '@lighttable/vector-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import { resolveVectorGradientGeometry } from './vectorGradientGeometry';
import { vectorElementsTopmostFirst } from './vectorSceneQueries';

interface ActiveGradientDrag {
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly elementId: string;
  readonly handle: 'start' | 'end';
  readonly documentToPaintParent: NonNullable<ReturnType<typeof resolveVectorGradientGeometry>>['documentToPaintParent'];
  readonly openingStart: Vec2;
  readonly openingEnd: Vec2;
  moved: boolean;
}

/** Owns the gradient-handle gesture so whole-element selection stays focused. */
export class VectorGradientHandleDragController {
  private drag: ActiveGradientDrag | null = null;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly getDocument: () => ImageDocument | null
  ) {}

  get active() { return this.drag !== null; }

  begin(document: ImageDocument, selection: VectorEditorSelection, point: Vec2, radius: number) {
    this.cancel();
    const target = this.targetAt(document, selection, point, radius);
    if (!target || !this.documents.beginElementMutations([target])) return false;
    this.drag = { documentId: document.id, ...target, moved: false };
    return true;
  }

  move(documentPoint: Vec2) {
    const drag = this.drag;
    if (!drag || this.getDocument()?.id !== drag.documentId) {
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
      if (target.layerId !== drag.layerId || target.elementId !== drag.elementId) {
        return target.openingElement;
      }
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

  finish(documentPoint: Vec2) {
    const drag = this.drag;
    if (!drag) return false;
    const accepted = this.move(documentPoint);
    if (!accepted || this.drag !== drag) return false;
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

  private targetAt(
    document: ImageDocument,
    selection: VectorEditorSelection,
    point: Vec2,
    radius: number
  ): Omit<ActiveGradientDrag, 'documentId' | 'moved'> | null {
    const selected = new Set(selection.elements.map(
      ({ layerId, elementId }) => `${layerId}\0${elementId}`
    ));
    let closest: (Omit<ActiveGradientDrag, 'documentId' | 'moved'>
      & { distanceSquared: number }) | null = null;
    for (const resolved of vectorElementsTopmostFirst(document)) {
      if (!selected.has(`${resolved.layerId}\0${resolved.elementId}`)) continue;
      const geometry = resolveVectorGradientGeometry(resolved);
      if (!geometry) continue;
      for (const handle of ['start', 'end'] as const) {
        const target = handle === 'start' ? geometry.startInDocument : geometry.endInDocument;
        const distanceSquared = (target.x - point.x) ** 2 + (target.y - point.y) ** 2;
        if (distanceSquared > radius ** 2 || (closest && distanceSquared >= closest.distanceSquared)) {
          continue;
        }
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
}
