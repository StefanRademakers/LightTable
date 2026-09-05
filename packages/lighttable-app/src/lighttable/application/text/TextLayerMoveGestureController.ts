import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { setLayerTransform } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';

interface Point { readonly x: number; readonly y: number }

export interface TextLayerMoveGestureDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  previewDocumentSnapshot(document: ImageDocument): void;
  discardDocumentPreview(): void;
  applyDocumentSnapshot(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

interface ActiveMove {
  readonly pointerId: number;
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly start: Point;
  readonly before: ImageDocument;
  latest: ImageDocument;
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
    this.active = {
      pointerId,
      documentId: document.id,
      layerId,
      start: { ...start },
      before: document,
      latest: document
    };
    return true;
  }

  move(pointerId: number, point: Point) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const source = findDocumentLayer(active.before, active.layerId);
    if (!document || document.id !== active.documentId
      || document.revision !== active.before.revision || source?.type !== 'text') {
      dependencies.discardDocumentPreview();
      this.active = null;
      return false;
    }
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    active.latest = setLayerTransform(active.before, active.layerId, {
      ...source.transform,
      tx: source.transform.tx + dx,
      ty: source.transform.ty + dy
    });
    dependencies.previewDocumentSnapshot(active.latest);
    return true;
  }

  finish(pointerId: number, point: Point) {
    if (!this.owns(pointerId)) return false;
    const active = this.active!;
    this.move(pointerId, point);
    if (this.active !== active) return false;
    const dependencies = this.dependencies();
    this.active = null;
    const current = dependencies.getDocument();
    if (!current || current.id !== active.documentId
      || current.revision !== active.before.revision || active.latest === active.before) {
      dependencies.discardDocumentPreview();
      return true;
    }
    dependencies.applyDocumentSnapshot(active.latest);
    dependencies.recordHistory(active.before, active.latest);
    return true;
  }

  cancel(pointerId?: number) {
    if (!this.active || (pointerId !== undefined && !this.owns(pointerId))) return false;
    const active = this.active!;
    this.active = null;
    this.dependencies().discardDocumentPreview();
    return true;
  }
}
