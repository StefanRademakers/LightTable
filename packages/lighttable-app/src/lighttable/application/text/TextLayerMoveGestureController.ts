import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { setLayerTransform } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

interface Point { readonly x: number; readonly y: number }

export interface TextLayerMoveGestureDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
}

interface ActiveMove {
  readonly pointerId: number;
  readonly layerId: LayerId;
  readonly start: Point;
  readonly transaction: DocumentMutationTransaction;
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
    const transaction = dependencies.documentMutations.begin(
      `text-move:${layerId}`,
      { label: 'Move Text Layer', type: 'text.move' }
    );
    if (!transaction) return false;
    this.active = {
      pointerId,
      layerId,
      start: { ...start },
      transaction
    };
    return true;
  }

  move(pointerId: number, point: Point) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const source = findDocumentLayer(active.transaction.before, active.layerId);
    if (!active.transaction.active || source?.type !== 'text') {
      active.transaction.cancel();
      this.active = null;
      return false;
    }
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    return active.transaction.change(() => setLayerTransform(
      active.transaction.before,
      active.layerId,
      {
      ...source.transform,
      tx: source.transform.tx + dx,
      ty: source.transform.ty + dy
      }
    ));
  }

  finish(pointerId: number, point: Point) {
    if (!this.owns(pointerId)) return false;
    const active = this.active!;
    this.move(pointerId, point);
    if (this.active !== active) return false;
    this.active = null;
    active.transaction.commit();
    return true;
  }

  cancel(pointerId?: number) {
    if (!this.active || (pointerId !== undefined && !this.owns(pointerId))) return false;
    const active = this.active;
    this.active = null;
    active.transaction.cancel();
    return true;
  }
}
