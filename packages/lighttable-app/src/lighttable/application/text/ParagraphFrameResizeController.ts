import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { AffineMatrix, Vec2 } from '../../editor/geometry/affine';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import {
  hitTestParagraphFrameHandle,
  resizeParagraphFrame,
  type ParagraphFrameHandleKind
} from './paragraphFrameResize';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

export interface ParagraphFrameResizeDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  getLocalToDocument(layerId: LayerId): AffineMatrix | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
}

interface ActiveResize {
  readonly pointerId: number;
  readonly layerId: LayerId;
  readonly transaction: DocumentMutationTransaction;
  readonly localToDocument: AffineMatrix;
  readonly openingFrame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly handle: ParagraphFrameHandleKind;
}

/** Owns one live paragraph-frame resize and its single undo boundary. */
export class ParagraphFrameResizeController {
  private active: ActiveResize | null = null;

  constructor(private readonly dependencies: () => ParagraphFrameResizeDependencies) {}

  begin(pointerId: number, documentPoint: Vec2, radius: number) {
    this.cancel();
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const layerId = dependencies.getEditingLayerId();
    const layer = document && layerId ? findDocumentLayer(document, layerId) : null;
    const source = layer?.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source
      : null;
    const localToDocument = layerId ? dependencies.getLocalToDocument(layerId) : null;
    if (!document || !layerId || source?.layout.mode !== 'paragraph' || !localToDocument) {
      return false;
    }
    const hit = hitTestParagraphFrameHandle(
      source.layout.frame, localToDocument, documentPoint, radius
    );
    if (!hit) return false;
    const transaction = dependencies.documentMutations.begin(
      `text-frame:${layerId}`,
      { label: 'Resize Text Frame', type: 'text.frame.resize' }
    );
    if (!transaction) return false;
    this.active = {
      pointerId,
      layerId,
      transaction,
      localToDocument: { ...localToDocument },
      openingFrame: { ...source.layout.frame },
      handle: hit.kind
    };
    return true;
  }

  owns(pointerId: number) {
    return this.active?.pointerId === pointerId;
  }

  move(pointerId: number, documentPoint: Vec2) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    if (!active.transaction.active) {
      active.transaction.cancel();
      this.active = null;
      return false;
    }
    const frame = resizeParagraphFrame(
      active.openingFrame,
      active.handle,
      documentPoint,
      active.localToDocument
    );
    if (!frame) return false;
    const openingLayer = findDocumentLayer(active.transaction.before, active.layerId);
    const openingSource = openingLayer?.type === 'text' && openingLayer.text.source.kind === 'flow'
      ? openingLayer.text.source
      : null;
    if (openingSource?.layout.mode !== 'paragraph') return false;
    const openingLayout = openingSource.layout;
    return active.transaction.change(() => setFlowTextLayout(
      active.transaction.before,
      active.layerId,
      {
        ...openingLayout,
        frame
      }
    ));
  }

  finish(pointerId: number, documentPoint: Vec2) {
    if (!this.owns(pointerId)) return false;
    this.move(pointerId, documentPoint);
    const active = this.active;
    this.active = null;
    return active ? active.transaction.commit() : false;
  }

  cancel(pointerId?: number) {
    const active = this.active;
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId)) return false;
    this.active = null;
    active.transaction.cancel();
    return true;
  }
}
