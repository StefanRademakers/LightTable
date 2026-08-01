import {
  convertAnchorToCorner,
  invertMatrix,
  setSymmetricAnchorHandles,
  transformPoint,
  type Vec2
} from '@lighttable/vector-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import { VectorDocumentController } from './VectorDocumentController';
import { VectorSelectionCommandController } from './VectorSelectionCommandController';
import { hitTestVectorDocument } from './vectorSceneQueries';

export type VectorPointToolMode = 'add-anchor' | 'delete-anchor' | 'convert-anchor';

export interface VectorPointToolDependencies {
  getDocument(): ImageDocument | null;
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface VectorPointToolPointerResult {
  handled: boolean;
  capture: boolean;
}

interface ConvertGesture {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  pathId: string;
  subpathId: string;
  anchorId: string;
  inverseDocumentTransform: NonNullable<ReturnType<typeof invertMatrix>>;
  startLocal: Vec2;
  moved: boolean;
}

const anchorSelection = (
  layerId: LayerId,
  pathId: string,
  subpathId: string,
  anchorId: string
): VectorEditorSelection => ({
  elements: [],
  paths: [],
  anchors: [{ layerId, pathId, subpathId, anchorId }],
  active: {
    layerId,
    pathId,
    target: { kind: 'anchor', subpathId, anchorId }
  }
});

/**
 * Photoshop-style point operations on native vector paths.
 *
 * Add and delete are single document commands. Convert is an interactive
 * mutation: clicking removes direction handles, while dragging creates a
 * symmetric pair. Scene transforms are resolved once at gesture start so the
 * document model remains path-local under nested transformed groups.
 */
export class VectorPointToolController {
  private convertGesture: ConvertGesture | null = null;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly commands: VectorSelectionCommandController,
    private readonly dependencies: VectorPointToolDependencies
  ) {}

  pointerDown(
    mode: VectorPointToolMode,
    documentPoint: Vec2,
    radius: number
  ): VectorPointToolPointerResult {
    this.cancel();
    const document = this.dependencies.getDocument();
    if (!document) return { handled: false, capture: false };
    const hit = hitTestVectorDocument(document, {
      documentPoint,
      radius,
      includeFill: false,
      includeHandles: false
    });
    if (!hit) return { handled: false, capture: false };

    if (mode === 'add-anchor') {
      if (hit.target.kind !== 'segment') return { handled: false, capture: false };
      this.dependencies.setSelection({
        elements: [],
        paths: [],
        anchors: [],
        active: {
          layerId: hit.layerId,
          pathId: hit.pathId,
          target: { ...hit.target }
        }
      });
      return {
        handled: this.commands.insertAnchorAtActiveSegment(),
        capture: false
      };
    }

    if (hit.target.kind !== 'anchor') return { handled: false, capture: false };
    this.dependencies.setSelection(anchorSelection(
      hit.layerId,
      hit.pathId,
      hit.target.subpathId,
      hit.target.anchorId
    ));
    if (mode === 'delete-anchor') {
      return { handled: this.commands.deleteSelection(), capture: false };
    }

    const inverse = invertMatrix(hit.documentPath.transform);
    if (!inverse || !this.documents.beginPathMutation(hit.layerId, hit.pathId)) {
      return { handled: false, capture: false };
    }
    const startLocal = transformPoint(inverse, documentPoint);
    this.convertGesture = {
      documentId: document.id,
      layerId: hit.layerId,
      pathId: hit.pathId,
      subpathId: hit.target.subpathId,
      anchorId: hit.target.anchorId,
      inverseDocumentTransform: inverse,
      startLocal,
      moved: false
    };
    return { handled: true, capture: true };
  }

  pointerMove(documentPoint: Vec2) {
    const gesture = this.validGesture();
    if (!gesture) return false;
    const local = transformPoint(gesture.inverseDocumentTransform, documentPoint);
    const moved = local.x !== gesture.startLocal.x || local.y !== gesture.startLocal.y;
    if (!moved) return false;
    gesture.moved = true;
    return this.documents.previewPathMutation((path) => setSymmetricAnchorHandles(
      path,
      { subpathId: gesture.subpathId, anchorId: gesture.anchorId },
      local
    ));
  }

  pointerUp(documentPoint: Vec2) {
    const gesture = this.validGesture();
    if (!gesture) return false;
    this.pointerMove(documentPoint);
    if (!gesture.moved) {
      this.documents.previewPathMutation((path) => convertAnchorToCorner(
        path,
        { subpathId: gesture.subpathId, anchorId: gesture.anchorId }
      ));
    }
    this.convertGesture = null;
    return this.documents.commitPathMutation();
  }

  cancel() {
    if (!this.convertGesture) return false;
    this.convertGesture = null;
    return this.documents.cancelPathMutation();
  }

  dispose() {
    this.cancel();
  }

  private validGesture() {
    const gesture = this.convertGesture;
    if (!gesture) return null;
    if (this.dependencies.getDocument()?.id === gesture.documentId) return gesture;
    this.cancel();
    return null;
  }
}
