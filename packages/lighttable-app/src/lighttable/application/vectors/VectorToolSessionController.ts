import type { VectorIdSource, Vec2, VectorStyle } from '@lighttable/vector-core';
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

export type VectorToolMode = 'direct-selection' | 'pen';

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
      if (this.pen.tryClose(
        documentPoint,
        options.closeTolerance ?? options.hitRadius
      )) return true;
      if (!this.pen.pointerDown(documentPoint)) return false;
    } else {
      const directOptions: DirectSelectionPointerOptions = {
        radius: options.hitRadius,
        additive: options.additive
      };
      if (!this.directSelection.pointerDown(documentPoint, directOptions)) return false;
    }

    this.capturedPointer = { id: pointerId, mode: this.activeMode, documentId };
    return true;
  }

  pointerMove(pointerId: number, documentPoint: Vec2) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    return capture.mode === 'pen'
      ? this.pen.pointerMove(documentPoint)
      : this.directSelection.pointerMove(documentPoint);
  }

  pointerUp(pointerId: number, documentPoint: Vec2, clickCount = 1) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    this.capturedPointer = null;
    if (capture.mode === 'direct-selection') {
      return this.directSelection.pointerUp(documentPoint);
    }
    const changed = this.pen.pointerUp(documentPoint);
    if (clickCount >= 2) this.pen.finishOpen();
    return changed;
  }

  pointerCancel(pointerId?: number) {
    if (pointerId !== undefined && this.capturedPointer?.id !== pointerId) return false;
    const mode = this.capturedPointer?.mode ?? this.activeMode;
    this.capturedPointer = null;
    if (mode === 'direct-selection') return this.directSelection.cancel();
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

  ownsPointer(pointerId: number) {
    return this.capturedPointer?.id === pointerId;
  }

  dispose() {
    if (this.disposed) return;
    this.finishActiveMode();
    this.directSelection.dispose();
    this.pen.dispose();
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
    }
  }

  private cancelActiveMode() {
    this.capturedPointer = null;
    this.directSelection.cancel();
    this.pen.cancel();
  }

  private assertAvailable() {
    return !this.disposed;
  }
}
