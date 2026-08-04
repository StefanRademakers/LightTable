import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { setLayerTransform } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';

interface Point { readonly x: number; readonly y: number }

export interface TextLayerMoveGestureDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

interface ActiveMove {
  readonly pointerId: number;
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly start: Point;
  readonly before: ImageDocument;
}

/** Ctrl-drag move gesture used while the native Type input bridge stays active. */
export class TextLayerMoveGestureController {
  private active: ActiveMove | null = null;

  constructor(private readonly dependencies: () => TextLayerMoveGestureDependencies) {}

  owns(pointerId: number) { return this.active?.pointerId === pointerId; }

  begin(pointerId: number, start: Point) {
    if (this.active) return false;
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const layerId = dependencies.getEditingLayerId();
    const layer = document && layerId ? findDocumentLayer(document, layerId) : null;
    if (!document || !layerId || layer?.type !== 'text' || layerIsLocked(layer, 'position')) return false;
    this.active = { pointerId, documentId: document.id, layerId, start: { ...start }, before: document };
    return true;
  }

  move(pointerId: number, point: Point) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const source = findDocumentLayer(active.before, active.layerId);
    if (!document || document.id !== active.documentId || source?.type !== 'text') {
      this.active = null;
      return false;
    }
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    dependencies.applyDocument(setLayerTransform(document, active.layerId, {
      ...source.transform,
      tx: source.transform.tx + dx,
      ty: source.transform.ty + dy
    }));
    return true;
  }

  finish(pointerId: number, point: Point) {
    if (!this.owns(pointerId)) return false;
    this.move(pointerId, point);
    const active = this.active!;
    const dependencies = this.dependencies();
    const after = dependencies.getDocument();
    this.active = null;
    if (after && after.id === active.documentId
      && (point.x !== active.start.x || point.y !== active.start.y)) {
      dependencies.recordHistory(active.before, after);
    }
    return true;
  }

  cancel(pointerId: number) {
    if (!this.owns(pointerId)) return false;
    const active = this.active!;
    this.active = null;
    if (this.dependencies().getDocument()?.id === active.documentId) {
      this.dependencies().applyDocument(active.before);
    }
    return true;
  }
}
