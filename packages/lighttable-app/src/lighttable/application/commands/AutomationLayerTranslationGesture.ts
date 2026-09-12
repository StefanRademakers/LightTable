import { layerIsLocked, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { setLayerTransform } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { DocumentMutationController, DocumentMutationTransaction, DocumentMutationCloseReason } from '../documents/useDocumentMutationController';
import { captureTransformGroupPreviewSources, projectTransformGroupPreviews,
  type TransformGroupPreviewSource } from '../tools/snapping/groupLayerTransform';

interface Point { readonly x: number; readonly y: number }
export interface AutomationGestureScope { isCurrent(): boolean }
interface TranslationPorts {
  getDocument(): ImageDocument | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
}
interface Translation {
  readonly pointerId: number;
  readonly start: Point;
  readonly scope: AutomationGestureScope;
  readonly source: TransformGroupPreviewSource;
  readonly transaction: DocumentMutationTransaction;
  reason: DocumentMutationCloseReason | null;
}

/** Owns the automation translation lease; canonical publication/history stay in documentMutations. */
export class AutomationLayerTranslationGesture {
  private active: Translation | null = null;
  constructor(private readonly ports: TranslationPorts) {}

  begin(pointerId: number, layerId: LayerId, start: Point, scope: AutomationGestureScope): boolean {
    if (this.active || !scope.isCurrent()) return false;
    const document = this.ports.getDocument();
    const layer = document && findDocumentLayer(document, layerId);
    if (!layer || layerIsLocked(layer, 'position')) return false;
    if (!captureTransformGroupPreviewSources(document!, [layerId]).length) return false;
    let owned: Translation | null = null;
    const transaction = this.ports.documentMutations.begin('automation.translate',
      { label: 'Move Layer', type: 'layer.transform', layerIds: [layerId] }, reason => {
        if (owned) owned.reason = reason;
        if (this.active === owned) this.active = null;
      }, 'cancel');
    if (!transaction) return false;
    // Starting a mutation may finish an older document gesture. Capture the admitted baseline.
    const source = captureTransformGroupPreviewSources(transaction.before, [layerId])[0];
    if (!scope.isCurrent() || !source || layerIsLocked(source.layer, 'position')) {
      transaction.cancel();
      return false;
    }
    owned = { pointerId, start: { ...start }, scope, source, transaction, reason: null };
    this.active = owned;
    return true;
  }

  update(pointerId: number, point: Point): boolean {
    const owned = this.active;
    if (!owned || owned.pointerId !== pointerId) return false;
    if (!owned.scope.isCurrent() || !owned.transaction.active) {
      this.cancel(pointerId);
      return false;
    }
    const dx = point.x - owned.start.x; const dy = point.y - owned.start.y;
    const matrix = projectTransformGroupPreviews([owned.source],
      { a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy })[0].matrix;
    owned.transaction.change(() => dx === 0 && dy === 0 ? owned.transaction.before
      : setLayerTransform(owned.transaction.before, owned.source.layer.id, matrix));
    // An identical sample is accepted without mistaking it for rejected admission.
    return owned.transaction.active;
  }

  finish(pointerId: number, commit: boolean): boolean {
    const owned = this.active;
    if (!owned || owned.pointerId !== pointerId) return false;
    if (!commit) return this.cancel(pointerId);
    if (!owned.scope.isCurrent() || !owned.transaction.active) {
      this.cancel(pointerId);
      return false;
    }
    owned.transaction.commit();
    // The mutation owner distinguishes a valid zero-delta terminal from stale/blocked cancellation.
    return owned.reason === 'commit';
  }

  cancel(pointerId: number): boolean {
    const owned = this.active;
    if (!owned || owned.pointerId !== pointerId) return false;
    this.active = null;
    return owned.transaction.cancel();
  }
}
