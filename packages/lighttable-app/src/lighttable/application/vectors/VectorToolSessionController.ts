import {
  type AnchorMode,
  type VectorIdSource,
  type Vec2,
  type VectorStyle
} from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import {
  DirectSelectionToolController,
  type DirectSelectionPointerOptions
} from './DirectSelectionToolController';
import { PenToolController } from './PenToolController';
import {
  VectorDocumentController,
  type VectorDocumentControllerDependencies
} from './VectorDocumentController';
import { VectorSelectionCommandController } from './VectorSelectionCommandController';
import {
  VectorPointToolController,
  type VectorPointToolMode
} from './VectorPointToolController';
import { hitTestVectorDocument } from './vectorSceneQueries';

export type VectorToolMode = 'direct-selection' | 'pen' | VectorPointToolMode;

export interface VectorToolSessionDependencies extends VectorDocumentControllerDependencies {
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface VectorToolSessionOptions {
  ids?: VectorIdSource;
  style?: () => VectorStyle;
  layerName?: string;
  pathName?: string;
}

export interface VectorPointerDownOptions {
  hitRadius: number;
  closeTolerance?: number;
  additive?: boolean;
}

interface CapturedPointer {
  readonly id: number;
  readonly mode: VectorToolMode;
  readonly documentId: ImageDocument['id'];
}

/**
 * Document-aware interaction boundary for native vector tools.
 *
 * The controller deliberately owns no React state and performs no viewport
 * projection. It serializes pointer ownership, pen-path lifetime, tool changes
 * and document changes around the focused geometry/document controllers. A
 * host can therefore mount one instance per open document without sharing a
 * gesture or provisional path with another workspace tab.
 */
export class VectorToolSessionController {
  private readonly documents: VectorDocumentController;
  private readonly directSelection: DirectSelectionToolController;
  private readonly pen: PenToolController;
  private readonly selectionCommands: VectorSelectionCommandController;
  private readonly pointTools: VectorPointToolController;
  private capturedPointer: CapturedPointer | null = null;
  private activeMode: VectorToolMode | null = null;
  private documentId: ImageDocument['id'] | null;
  private disposed = false;

  constructor(
    private readonly dependencies: VectorToolSessionDependencies,
    options: VectorToolSessionOptions = {}
  ) {
    this.documentId = dependencies.getDocument()?.id ?? null;
    this.documents = new VectorDocumentController(() => this.dependencies);
    this.directSelection = new DirectSelectionToolController(this.documents, dependencies);
    this.pen = new PenToolController(this.documents, options);
    this.selectionCommands = options.ids
      ? new VectorSelectionCommandController(this.documents, dependencies, options.ids)
      : new VectorSelectionCommandController(this.documents, dependencies);
    this.pointTools = new VectorPointToolController(
      this.documents,
      this.selectionCommands,
      dependencies
    );
  }

  activate(mode: VectorToolMode) {
    if (!this.assertAvailable()) return false;
    this.synchronizeDocument();
    if (this.activeMode === mode) return true;
    this.finishActiveMode();
    this.activeMode = mode;
    return true;
  }

  deactivate() {
    if (!this.assertAvailable()) return false;
    const changed = this.activeMode !== null || this.capturedPointer !== null;
    this.finishActiveMode();
    this.activeMode = null;
    return changed;
  }

  pointerDown(
    pointerId: number,
    documentPoint: Vec2,
    options: VectorPointerDownOptions
  ) {
    if (!this.assertAvailable() || !this.activeMode || this.capturedPointer) return false;
    if (!this.synchronizeDocument()) return false;
    const documentId = this.dependencies.getDocument()?.id;
    if (!documentId) return false;

    if (this.activeMode === 'pen') {
      if (!this.pen.isActive() && this.tryResumePenPath(documentPoint, options.hitRadius)) {
        return true;
      }
      if (this.pen.tryClose(
        documentPoint,
        options.closeTolerance ?? options.hitRadius
      )) return true;
      if (this.pen.isActive() && this.tryConnectPenPath(documentPoint, options.hitRadius)) {
        return true;
      }
      if (!this.pen.pointerDown(documentPoint)) return false;
    } else if (this.activeMode === 'direct-selection') {
      const directOptions: DirectSelectionPointerOptions = {
        radius: options.hitRadius,
        additive: options.additive
      };
      if (!this.directSelection.pointerDown(documentPoint, directOptions)) return false;
    } else {
      const result = this.pointTools.pointerDown(
        this.activeMode,
        documentPoint,
        options.hitRadius
      );
      if (!result.handled) return false;
      if (!result.capture) return true;
    }

    this.capturedPointer = { id: pointerId, mode: this.activeMode, documentId };
    return true;
  }

  pointerMove(pointerId: number, documentPoint: Vec2) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    if (capture.mode === 'pen') return this.pen.pointerMove(documentPoint);
    if (capture.mode === 'direct-selection') return this.directSelection.pointerMove(documentPoint);
    return this.pointTools.pointerMove(documentPoint);
  }

  pointerUp(pointerId: number, documentPoint: Vec2, clickCount = 1) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    this.capturedPointer = null;
    if (capture.mode === 'direct-selection') {
      return this.directSelection.pointerUp(documentPoint);
    }
    if (capture.mode !== 'pen') return this.pointTools.pointerUp(documentPoint);
    const changed = this.pen.pointerUp(documentPoint);
    if (clickCount >= 2) this.pen.finishOpen();
    return changed;
  }

  pointerCancel(pointerId?: number) {
    if (pointerId !== undefined && this.capturedPointer?.id !== pointerId) return false;
    const mode = this.capturedPointer?.mode ?? this.activeMode;
    this.capturedPointer = null;
    if (mode === 'direct-selection') return this.directSelection.cancel();
    if (mode && mode !== 'pen') return this.pointTools.cancel();
    // Cancelling a pointer gesture must not discard previously placed anchors.
    return mode === 'pen' ? this.pen.cancelPointerGesture() : false;
  }

  finishPenPath() {
    if (!this.assertAvailable() || this.activeMode !== 'pen') return false;
    this.capturedPointer = null;
    return this.pen.finishOpen();
  }

  cancelPenPath() {
    if (!this.assertAvailable()) return false;
    this.capturedPointer = null;
    return this.pen.cancel();
  }

  clearSelection() {
    if (!this.assertAvailable()) return false;
    this.directSelection.clearSelection();
    return true;
  }

  deleteSelection() {
    return this.prepareSelectionCommand() && this.selectionCommands.deleteSelection();
  }

  nudgeSelection(documentDelta: Vec2) {
    return this.prepareSelectionCommand()
      && this.selectionCommands.nudgeSelection(documentDelta);
  }

  setSelectedAnchorMode(mode: AnchorMode) {
    return this.prepareSelectionCommand()
      && this.selectionCommands.setSelectedAnchorMode(mode);
  }

  insertAnchorAtActiveSegment() {
    return this.prepareSelectionCommand()
      && this.selectionCommands.insertAnchorAtActiveSegment();
  }

  directSelectionMarquee() {
    return this.directSelection.marqueeRect();
  }

  ownsPointer(pointerId: number) {
    return this.capturedPointer?.id === pointerId;
  }

  dispose() {
    if (this.disposed) return;
    this.finishActiveMode();
    this.directSelection.dispose();
    this.pen.dispose();
    this.pointTools.dispose();
    this.documents.dispose();
    this.disposed = true;
  }

  private validCapture(pointerId: number) {
    if (!this.assertAvailable() || this.capturedPointer?.id !== pointerId) return null;
    if (!this.synchronizeDocument()) return null;
    return this.capturedPointer;
  }

  private synchronizeDocument() {
    const currentId = this.dependencies.getDocument()?.id ?? null;
    if (currentId === this.documentId) return currentId !== null;
    this.cancelActiveMode();
    this.documentId = currentId;
    return currentId !== null;
  }

  private prepareSelectionCommand() {
    if (!this.assertAvailable() || this.capturedPointer) return false;
    return this.synchronizeDocument();
  }

  private finishActiveMode() {
    this.capturedPointer = null;
    if (this.activeMode === 'direct-selection') {
      this.directSelection.cancel();
      return;
    }
    if (this.activeMode === 'pen') {
      const path = this.pen.snapshot().path;
      const anchorCount = path?.subpaths.reduce(
        (total, subpath) => total + subpath.anchors.length,
        0
      ) ?? 0;
      if (anchorCount >= 2) this.pen.finishOpen();
      else this.pen.cancel();
      return;
    }
    this.pointTools.cancel();
  }

  private cancelActiveMode() {
    this.capturedPointer = null;
    this.directSelection.cancel();
    this.pen.cancel();
    this.pointTools.cancel();
  }

  private assertAvailable() {
    return !this.disposed;
  }

  private tryResumePenPath(documentPoint: Vec2, radius: number) {
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const hit = hitTestVectorDocument(document, {
      documentPoint,
      radius,
      includeFill: false,
      includeHandles: false
    });
    if (!hit || hit.target.kind !== 'anchor') return false;
    const target = hit.target;
    const path = hit.layer.paths.find(({ id }) => id === hit.pathId);
    const subpath = path?.subpaths.find(({ id }) => id === target.subpathId);
    if (!path || !subpath || subpath.closed || subpath.anchors.length === 0) return false;
    const index = subpath.anchors.findIndex(({ id }) => id === target.anchorId);
    const direction = index === subpath.anchors.length - 1
      ? 'append'
      : index === 0
        ? 'prepend'
        : null;
    return direction
      ? this.pen.resumePath(
          hit.layerId,
          path,
          subpath.id,
          direction,
          hit.documentPath.transform
        )
      : false;
  }

  private tryConnectPenPath(documentPoint: Vec2, radius: number) {
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const hit = hitTestVectorDocument(document, {
      documentPoint,
      radius,
      includeFill: false,
      includeHandles: false
    });
    if (!hit || hit.target.kind !== 'anchor') return false;
    const target = hit.target;
    const subpath = hit.documentPath.subpaths.find(({ id }) => id === target.subpathId);
    if (!subpath || subpath.closed || subpath.anchors.length === 0) return false;
    const index = subpath.anchors.findIndex(({ id }) => id === target.anchorId);
    const endpoint = index === 0
      ? 'start'
      : index === subpath.anchors.length - 1
        ? 'end'
        : null;
    return endpoint
      ? this.pen.connectPath(
          hit.layerId,
          hit.documentPath,
          subpath.id,
          endpoint
        )
      : false;
  }
}
