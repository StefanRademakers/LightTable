import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { AffineMatrix, Vec2 } from '../../editor/geometry/affine';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import {
  hitTestParagraphFrameHandle,
  resizeParagraphFrame,
  type ParagraphFrameHandleKind
} from './paragraphFrameResize';

export interface ParagraphFrameResizeDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  getLocalToDocument(layerId: LayerId): AffineMatrix | null;
  previewDocumentSnapshot(document: ImageDocument): void;
  discardDocumentPreview(): void;
  applyDocumentSnapshot(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

interface ActiveResize {
  readonly pointerId: number;
  readonly documentId: ImageDocument['id'];
  readonly layerId: LayerId;
  readonly before: ImageDocument;
  readonly localToDocument: AffineMatrix;
  readonly openingFrame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly handle: ParagraphFrameHandleKind;
  latest: ImageDocument;
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
    this.active = {
      pointerId,
      documentId: document.id,
      layerId,
      before: document,
      localToDocument: { ...localToDocument },
      openingFrame: { ...source.layout.frame },
      handle: hit.kind,
      latest: document
    };
    return true;
  }

  owns(pointerId: number) {
    return this.active?.pointerId === pointerId;
  }

  move(pointerId: number, documentPoint: Vec2) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    const dependencies = this.dependencies();
    const current = dependencies.getDocument();
    if (current?.id !== active.documentId
      || current.revision !== active.before.revision) {
      dependencies.discardDocumentPreview();
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
    const openingLayer = findDocumentLayer(active.before, active.layerId);
    const openingSource = openingLayer?.type === 'text' && openingLayer.text.source.kind === 'flow'
      ? openingLayer.text.source
      : null;
    if (openingSource?.layout.mode !== 'paragraph') return false;
    const next = setFlowTextLayout(active.before, active.layerId, {
      ...openingSource.layout,
      frame
    });
    active.latest = next;
    dependencies.previewDocumentSnapshot(next);
    return true;
  }

  finish(pointerId: number, documentPoint: Vec2) {
    if (!this.owns(pointerId)) return false;
    this.move(pointerId, documentPoint);
    const active = this.active;
    this.active = null;
    if (!active || active.latest === active.before) return false;
    const dependencies = this.dependencies();
    const current = dependencies.getDocument();
    if (current?.id !== active.documentId
      || current.revision !== active.before.revision) {
      dependencies.discardDocumentPreview();
      return false;
    }
    dependencies.applyDocumentSnapshot(active.latest);
    dependencies.recordHistory(active.before, active.latest);
    return true;
  }

  cancel(pointerId?: number) {
    const active = this.active;
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId)) return false;
    this.active = null;
    this.dependencies().discardDocumentPreview();
    return true;
  }
}
