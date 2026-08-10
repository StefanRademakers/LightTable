import {
  cloneVectorElement,
  type AnchorMode,
  type VectorIdSource,
  type VectorElement,
  type VectorLiveShape,
  type VectorPath,
  type Vec2,
  type VectorStyle
} from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createVectorEditorSelection,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import {
  buildVectorEditingOverlay,
  type VectorEditingOverlay
} from '@lighttable/vector-rendering';
import {
  DirectSelectionToolController,
  type DirectSelectionPointerOptions
} from './DirectSelectionToolController';
import { PenToolController, type PenRubberBand } from './PenToolController';
import {
  LiveShapeToolController,
  type LiveShapeDragOptions,
  type LiveShapeDragUpdateOptions,
  type LiveShapeToolPreset
} from './LiveShapeToolController';
import {
  VectorDocumentController,
  type VectorElementCreationTransaction,
  type VectorDocumentControllerDependencies
} from './VectorDocumentController';
import { VectorSelectionCommandController } from './VectorSelectionCommandController';
import { VectorElementSelectionToolController } from './VectorElementSelectionToolController';
import {
  VectorPointToolController,
  type VectorPointToolMode
} from './VectorPointToolController';
import { hitTestVectorDocument } from './vectorSceneQueries';
import {
  GradientToolController,
  type GradientToolSettingsSnapshot
} from './GradientToolController';

export type VectorToolMode = 'element-selection' | 'direct-selection' | 'pen' | 'live-shape' | 'gradient' | VectorPointToolMode;

export interface VectorToolSessionDependencies extends VectorDocumentControllerDependencies {
  getSelection(): VectorEditorSelection;
  setSelection(selection: VectorEditorSelection): void;
}

export interface VectorToolSessionOptions {
  ids?: VectorIdSource;
  penStyle?: () => VectorStyle;
  liveShapeStyle?: () => VectorStyle;
  gradientSettings?: () => GradientToolSettingsSnapshot;
  layerName?: string;
  pathName?: string;
  rasterizeShape?: (transaction: VectorElementCreationTransaction) => boolean;
  requestGradientColorEditor?: (endpoint: 'start' | 'end') => void;
}

export interface VectorPointerDownOptions extends LiveShapeDragOptions {
  hitRadius: number;
  closeTolerance?: number;
  additive?: boolean;
  autoAddDelete?: boolean;
  temporaryDirect?: boolean;
  temporaryConvert?: boolean;
}

interface CapturedPointer {
  readonly id: number;
  readonly mode: VectorToolMode;
  readonly documentId: ImageDocument['id'];
  readonly rasterize?: boolean;
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
  private readonly elementSelection: VectorElementSelectionToolController;
  private readonly pen: PenToolController;
  private readonly liveShape: LiveShapeToolController;
  private readonly gradient: GradientToolController;
  private readonly selectionCommands: VectorSelectionCommandController;
  private readonly pointTools: VectorPointToolController;
  private capturedPointer: CapturedPointer | null = null;
  private activeMode: VectorToolMode | null = null;
  private documentId: ImageDocument['id'] | null;
  private disposed = false;
  private readonly rasterizeShape?: (transaction: VectorElementCreationTransaction) => boolean;

  constructor(
    private readonly dependencies: VectorToolSessionDependencies,
    options: VectorToolSessionOptions = {}
  ) {
    this.rasterizeShape = options.rasterizeShape;
    this.documentId = dependencies.getDocument()?.id ?? null;
    this.documents = new VectorDocumentController(() => this.dependencies);
    this.directSelection = new DirectSelectionToolController(this.documents, dependencies);
    this.elementSelection = new VectorElementSelectionToolController(this.documents, dependencies);
    this.pen = new PenToolController(this.documents, {
      ids: options.ids,
      style: options.penStyle,
      layerName: options.layerName,
      pathName: options.pathName
    });
    this.liveShape = new LiveShapeToolController(
      this.documents,
      { kind: 'rectangle' },
      {
        ids: options.ids,
        style: options.liveShapeStyle,
        layerName: options.layerName
      }
    );
    this.gradient = new GradientToolController(
      this.documents,
      options.gradientSettings ?? (() => {
        throw new Error('Gradient tool settings are unavailable.');
      }),
      ({ layerId, elementId }) => this.dependencies.setSelection({
        elements: [{ layerId, elementId }],
        paths: [],
        anchors: [],
        active: null
      }),
      options.requestGradientColorEditor
    );
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
    if (this.activeMode !== mode) {
      this.finishActiveMode();
      this.activeMode = mode;
    }
    if (mode === 'element-selection'
      && this.dependencies.getSelection().elements.length === 0) {
      this.selectLayerElements(this.dependencies.getDocument()?.activeLayerId ?? null);
    }
    return true;
  }

  deactivate() {
    if (!this.assertAvailable()) return false;
    const changed = this.activeMode !== null || this.capturedPointer !== null;
    this.finishActiveMode();
    this.activeMode = null;
    return changed;
  }

  setLiveShapePreset(preset: LiveShapeToolPreset) {
    if (!this.assertAvailable() || this.capturedPointer) return false;
    if (!this.synchronizeDocument()) return false;
    return this.liveShape.setPreset(preset);
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
      if (options.temporaryDirect) {
        const document = this.dependencies.getDocument();
        const hit = document ? hitTestVectorDocument(document, {
          documentPoint,
          radius: options.hitRadius,
          includeFill: true,
          includeHandles: true
        }) : null;
        if (this.pen.isActive() && !hit) return this.pen.finishOpen();
        if (!this.directSelection.pointerDown(documentPoint, {
          radius: options.hitRadius,
          additive: options.additive,
          breakHandle: options.temporaryConvert
        })) return false;
        this.capturedPointer = { id: pointerId, mode: 'direct-selection', documentId };
        return true;
      }
      if (options.temporaryConvert) {
        const converted = this.pointTools.pointerDown('convert-anchor', documentPoint, options.hitRadius);
        if (!converted.handled) return false;
        if (converted.capture) {
          this.capturedPointer = { id: pointerId, mode: 'convert-anchor', documentId };
        }
        return true;
      }
      if (!this.pen.isActive() && options.autoAddDelete) {
        const deleted = this.pointTools.pointerDown('delete-anchor', documentPoint, options.hitRadius);
        if (deleted.handled) return true;
        const added = this.pointTools.pointerDown('add-anchor', documentPoint, options.hitRadius);
        if (added.handled) return true;
      }
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
    } else if (this.activeMode === 'element-selection') {
      if (!this.elementSelection.pointerDown(documentPoint, {
        radius: options.hitRadius,
        additive: options.additive,
        preserveAspect: options.preserveAspect
      })) return false;
    } else if (this.activeMode === 'direct-selection') {
      const directOptions: DirectSelectionPointerOptions = {
        radius: options.hitRadius,
        additive: options.additive
      };
      if (!this.directSelection.pointerDown(documentPoint, directOptions)) return false;
    } else if (this.activeMode === 'live-shape') {
      if (!this.liveShape.pointerDown(documentPoint, {
        preserveAspect: options.preserveAspect,
        fromCenter: options.fromCenter,
        fixedSize: options.fixedSize,
        proportionalRatio: options.proportionalRatio,
        snapToPixels: options.snapToPixels
      })) return false;
    } else if (this.activeMode === 'gradient') {
      if (!this.gradient.pointerDown(documentPoint, options.hitRadius)) return false;
    } else {
      const result = this.pointTools.pointerDown(
        this.activeMode,
        documentPoint,
        options.hitRadius
      );
      if (!result.handled) return false;
      if (!result.capture) return true;
    }

    this.capturedPointer = {
      id: pointerId,
      mode: this.activeMode,
      documentId,
      rasterize: this.activeMode === 'live-shape' && options.rasterize
    };
    return true;
  }

  pointerMove(
    pointerId: number,
    documentPoint: Vec2,
    options: LiveShapeDragUpdateOptions = {}
  ) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    if (capture.mode === 'pen') {
      return this.pen.pointerMove(documentPoint, options.preserveAspect);
    }
    if (capture.mode === 'element-selection') return this.elementSelection.pointerMove(documentPoint);
    if (capture.mode === 'direct-selection') return this.directSelection.pointerMove(documentPoint);
    if (capture.mode === 'live-shape') return this.liveShape.pointerMove(documentPoint, options);
    if (capture.mode === 'gradient') return this.gradient.pointerMove(
      documentPoint,
      options.preserveAspect
    );
    return this.pointTools.pointerMove(documentPoint);
  }

  pointerUp(
    pointerId: number,
    documentPoint: Vec2,
    clickCount = 1,
    options: LiveShapeDragUpdateOptions = {}
  ) {
    const capture = this.validCapture(pointerId);
    if (!capture) return false;
    this.capturedPointer = null;
    if (capture.mode === 'element-selection') {
      return this.elementSelection.pointerUp(documentPoint);
    }
    if (capture.mode === 'direct-selection') {
      return this.directSelection.pointerUp(documentPoint);
    }
    if (capture.mode === 'live-shape') {
      if (options.rasterize || capture.rasterize) {
        const transaction = this.liveShape.pointerUpForRaster(documentPoint, options);
        if (!transaction || !this.rasterizeShape?.(transaction)) {
          if (transaction) this.dependencies.applyDocumentSnapshot(transaction.beforeDocument);
          return false;
        }
        return true;
      }
      return this.liveShape.pointerUp(documentPoint, options);
    }
    if (capture.mode === 'gradient') return this.gradient.pointerUp(
      documentPoint,
      options.preserveAspect
    );
    if (capture.mode !== 'pen') return this.pointTools.pointerUp(documentPoint);
    const changed = this.pen.pointerUp(documentPoint, options.preserveAspect);
    if (clickCount >= 2) this.pen.finishOpen();
    return changed;
  }

  pointerCancel(pointerId?: number) {
    if (pointerId !== undefined && this.capturedPointer?.id !== pointerId) return false;
    const mode = this.capturedPointer?.mode ?? this.activeMode;
    this.capturedPointer = null;
    if (mode === 'element-selection') return this.elementSelection.cancel();
    if (mode === 'direct-selection') return this.directSelection.cancel();
    if (mode === 'live-shape') return this.liveShape.cancel();
    if (mode === 'gradient') return this.gradient.cancel();
    if (mode && mode !== 'pen') return this.pointTools.cancel();
    // Cancelling a pointer gesture must not discard previously placed anchors.
    return mode === 'pen' ? this.pen.cancelPointerGesture() : false;
  }

  finishPenPath() {
    if (!this.assertAvailable() || this.activeMode !== 'pen') return false;
    this.capturedPointer = null;
    return this.pen.finishOpen();
  }

  penRubberBand(documentPoint: Vec2): PenRubberBand | null {
    if (!this.assertAvailable() || this.activeMode !== 'pen' || this.capturedPointer) return null;
    return this.pen.rubberBand(documentPoint);
  }

  penEditingOverlay(): VectorEditingOverlay | null {
    if (!this.assertAvailable() || this.activeMode !== 'pen') return null;
    const snapshot = this.pen.snapshot();
    const path = snapshot.path;
    const subpathId = snapshot.activeSubpathId;
    if (!path || !subpathId) return null;
    const subpath = path.subpaths.find(({ id }) => id === subpathId);
    const anchor = snapshot.activeEndpoint === 'prepend'
      ? subpath?.anchors[0]
      : subpath?.anchors.at(-1);
    const activeAnchor = anchor ? { subpathId, anchorId: anchor.id } : null;
    const overlay = buildVectorEditingOverlay({
      ...path,
      transform: { ...snapshot.pathToDocument }
    }, {
      selection: {
        anchors: activeAnchor ? [activeAnchor] : [],
        activeAnchor
      }
    });
    return {
      ...overlay,
      resourceKey: `${overlay.resourceKey}:pen-presentation-${snapshot.presentationRevision}`
    };
  }

  cancelPenPath() {
    if (!this.assertAvailable()) return false;
    this.capturedPointer = null;
    return this.pen.cancel();
  }

  undoPenAnchor() {
    if (!this.assertAvailable() || this.activeMode !== 'pen') return false;
    this.capturedPointer = null;
    return this.pen.undoLastAnchor();
  }

  clearSelection() {
    if (!this.assertAvailable()) return false;
    this.elementSelection.clearSelection();
    return true;
  }

  /**
   * Ends provisional vector work before the host changes the active layer.
   * A multi-click Pen path otherwise retains its creation layer and subsequent
   * clicks appear to ignore the Layers panel selection.
   */
  prepareActiveLayerChange(nextLayerId: ImageDocument['activeLayerId']) {
    if (!this.assertAvailable()) return false;
    const document = this.dependencies.getDocument();
    if (!document) return true;
    if (document.activeLayerId !== nextLayerId) this.finishActiveMode();
    this.selectLayerElements(nextLayerId);
    return true;
  }

  private selectLayerElements(layerId: ImageDocument['activeLayerId']) {
    const document = this.dependencies.getDocument();
    const layer = document && layerId ? findDocumentLayer(document, layerId) : null;
    const selection = createVectorEditorSelection();
    if (layer?.type === 'vector') {
      selection.elements = layer.elements.map((element) => ({
        layerId: layer.id,
        elementId: element.id
      }));
    }
    this.dependencies.setSelection(selection);
  }

  deleteSelection() {
    return this.prepareSelectionCommand() && this.selectionCommands.deleteSelection();
  }

  nudgeSelection(documentDelta: Vec2) {
    return this.prepareSelectionCommand()
      && this.selectionCommands.nudgeSelection(documentDelta);
  }

  editSelectedElementStyles(edit: (style: VectorStyle) => VectorStyle) {
    if (!this.prepareSelectionCommand()) return false;
    const selection = this.dependencies.getSelection();
    const addresses = new Map<string, VectorEditorSelection['elements'][number]>();
    for (const reference of selection.elements) {
      addresses.set(`${reference.layerId}\0${reference.elementId}`, reference);
    }
    for (const reference of selection.paths) {
      addresses.set(`${reference.layerId}\0${reference.pathId}`, {
        layerId: reference.layerId,
        elementId: reference.pathId
      });
    }
    return this.documents.editElements([...addresses.values()].map(({ layerId, elementId }) => ({
      layerId,
      elementId,
      edit: (element) => {
        const next = cloneVectorElement(element);
        next.style = edit(next.style);
        next.styleRevision += 1;
        return next;
      }
    })));
  }

  editSelectedLiveShapes(edit: (shape: VectorLiveShape) => VectorLiveShape) {
    if (!this.prepareSelectionCommand()) return false;
    const document = this.dependencies.getDocument();
    if (!document) return false;
    const edits = this.dependencies.getSelection().elements.flatMap(({ layerId, elementId }) => {
      const layer = findDocumentLayer(document, layerId);
      const element = layer?.type === 'vector'
        ? layer.elements.find(({ id }) => id === elementId)
        : null;
      if (element?.type !== 'live-shape') return [];
      return [{
        layerId,
        elementId,
        edit: (current: VectorElement) => {
          if (current.type !== 'live-shape') return current;
          const next = edit(cloneVectorElement(current) as VectorLiveShape);
          next.geometryRevision += 1;
          return next;
        }
      }];
    });
    return edits.length > 0 && this.documents.editElements(edits);
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
    this.elementSelection.dispose();
    this.pen.dispose();
    this.liveShape.dispose();
    this.gradient.dispose();
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
    if (this.activeMode === 'element-selection') {
      this.elementSelection.cancel();
      return;
    }
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
    if (this.activeMode === 'live-shape') {
      this.liveShape.cancel();
      return;
    }
    if (this.activeMode === 'gradient') {
      this.gradient.cancel();
      return;
    }
    this.pointTools.cancel();
  }

  private cancelActiveMode() {
    this.capturedPointer = null;
    this.directSelection.cancel();
    this.elementSelection.cancel();
    this.pen.cancel();
    this.liveShape.cancel();
    this.gradient.cancel();
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
    const path = hit.layer.elements.find(
      (element): element is VectorPath => element.type === 'path' && element.id === hit.pathId
    );
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
