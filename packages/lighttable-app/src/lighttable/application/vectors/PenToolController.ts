import {
  identityAffineMatrix,
  invertMatrix,
  joinVectorPathEndpoints,
  cloneVectorPath,
  cloneVectorStyle,
  PenPathBuilder,
  transformPoint,
  type AffineMatrix,
  type PenPathDirection,
  type Vec2,
  type VectorIdSource,
  type VectorPath,
  type VectorStyle
} from '@lighttable/vector-core';
import { layerIsLocked, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { VectorDocumentController } from './VectorDocumentController';

const distanceSquared = (left: Vec2, right: Vec2) => {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
};

const defaultPenStyle = (): VectorStyle => ({
  fill: null,
  stroke: {
    paint: { type: 'solid', color: [0, 0, 0, 1] },
    width: 2,
    cap: 'round',
    join: 'round',
    miterLimit: 4,
    dash: [],
    dashOffset: 0
  },
  opacity: 1
});

interface PlaceAnchorGesture {
  kind: 'place';
  position: Vec2;
}

interface ClosePathGesture {
  kind: 'close';
  pointerDown: Vec2;
  anchorPosition: Vec2;
  anchorId: string;
}

type AnchorGesture = PlaceAnchorGesture | ClosePathGesture;

const constrainDirection = (origin: Vec2, point: Vec2): Vec2 => {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return { ...point };
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
};

export interface PenToolControllerOptions {
  ids?: VectorIdSource;
  style?: () => VectorStyle;
  layerName?: string;
  pathName?: string;
  onCommitted?: (result: {
    readonly operation: 'create' | 'update';
    readonly layerId: LayerId;
    readonly layerName: string;
    readonly path: VectorPath;
    readonly existingLayerId?: LayerId;
  }) => void;
}

export interface PenToolSnapshot {
  layerId: LayerId | null;
  path: VectorPath | null;
  pathToDocument: AffineMatrix;
  activeSubpathId: string | null;
  activeEndpoint: PenPathDirection | null;
  presentationRevision: number;
  anchorGestureActive: boolean;
  closingAnchorId: string | null;
}

export interface PenRubberBand {
  from: Vec2;
  to: Vec2;
}

const uuidIds: VectorIdSource = {
  next: (kind) => `${kind}-${crypto.randomUUID()}`
};

/**
 * Framework-neutral Pen interaction state.
 *
 * Viewport projection stays with the host. This controller receives document
 * coordinates, owns provisional Bézier construction, and delegates the one-
 * history-entry document transaction to VectorDocumentController.
 */
export class PenToolController {
  private builder: PenPathBuilder | null = null;
  private layerId: LayerId | null = null;
  private gesture: AnchorGesture | null = null;
  private readonly ids: VectorIdSource;
  private readonly style: () => VectorStyle;
  private readonly layerName: string;
  private readonly pathName: string;
  private documentToPath: AffineMatrix = identityAffineMatrix();
  private pathToDocument: AffineMatrix = identityAffineMatrix();
  private transaction: 'creation' | 'mutation' | null = null;
  private authoredStyle: VectorStyle | null = null;
  private presentedPath: VectorPath | null = null;
  private existingLayerId: LayerId | null = null;
  private readonly onCommitted?: PenToolControllerOptions['onCommitted'];
  private presentationRevision = 0;

  constructor(
    private readonly documents: VectorDocumentController,
    options: PenToolControllerOptions = {}
  ) {
    this.ids = options.ids ?? uuidIds;
    this.style = options.style ?? defaultPenStyle;
    this.layerName = options.layerName ?? 'Shape';
    this.pathName = options.pathName ?? 'Path';
    this.onCommitted = options.onCommitted;
  }

  pointerDown(position: Vec2) {
    if (this.gesture) return false;
    if (!this.builder && !this.openPath()) return false;
    this.gesture = {
      kind: 'place',
      position: transformPoint(this.documentToPath, position)
    };
    return true;
  }

  pointerMove(position: Vec2, constrain = false) {
    if (!this.builder || !this.gesture) return false;
    const local = transformPoint(this.documentToPath, position);
    if (this.gesture.kind === 'close') {
      const dragTo = constrain
        ? constrainDirection(this.gesture.anchorPosition, local)
        : local;
      this.presentedPath = this.builder.previewClose({ dragTo });
    } else {
      this.presentedPath = this.builder.previewPlace(this.gesture.position, {
        dragTo: constrain ? constrainDirection(this.gesture.position, local) : local
      });
    }
    this.presentationRevision += 1;
    return true;
  }

  pointerUp(position: Vec2, constrain = false) {
    if (!this.builder || !this.gesture) return false;
    const gesture = this.gesture;
    this.gesture = null;
    const rawLocal = transformPoint(this.documentToPath, position);
    if (gesture.kind === 'close') {
      const local = constrain
        ? constrainDirection(gesture.anchorPosition, rawLocal)
        : rawLocal;
      const dragTo = distanceSquared(gesture.pointerDown, rawLocal) > 1e-6
        ? local
        : undefined;
      const closed = this.restoreAuthoredStyle(this.builder.close({ dragTo }));
      if (!this.preview(closed)) return false;
      return this.commit();
    }
    const local = constrain ? constrainDirection(gesture.position, rawLocal) : rawLocal;
    const dragTo = distanceSquared(gesture.position, local) > 0 ? local : undefined;
    return this.preview(this.builder.place(gesture.position, { dragTo }));
  }

  /** Begins a close gesture; the path is finalized only when the pointer is released. */
  beginClose(position: Vec2, tolerance: number) {
    const first = this.builder?.firstAnchor();
    if (this.gesture || !first || !this.builder || this.builder.anchorCount() < 3) return false;
    const firstDocument = transformPoint(this.pathToDocument, first.position);
    if (distanceSquared(firstDocument, position) > tolerance * tolerance) return false;
    this.gesture = {
      kind: 'close',
      pointerDown: transformPoint(this.documentToPath, position),
      anchorPosition: { ...first.position },
      anchorId: first.id
    };
    this.presentedPath = this.builder.previewClose();
    this.presentationRevision += 1;
    return true;
  }

  connectPath(
    targetLayerId: LayerId,
    targetPath: VectorPath,
    targetSubpathId: string,
    targetEndpoint: 'start' | 'end'
  ) {
    if (!this.builder || !this.layerId || this.gesture) return false;
    const active = this.restoreAuthoredStyle(this.builder.snapshot());
    if (
      active.id === targetPath.id
      && this.builder.activeSubpathId() === targetSubpathId
    ) return false;
    const activeDocumentPath = { ...active, transform: { ...this.pathToDocument } };
    const connectedDocumentPath = joinVectorPathEndpoints(
      activeDocumentPath,
      {
        subpathId: this.builder.activeSubpathId(),
        endpoint: this.builder.activeEndpoint() === 'append' ? 'end' : 'start'
      },
      targetPath,
      { subpathId: targetSubpathId, endpoint: targetEndpoint }
    );
    const connectedStoredPath = {
      ...connectedDocumentPath,
      transform: { ...active.transform }
    };
    const committed = this.documents.commitActivePathConnection(
      targetLayerId,
      targetPath.id,
      connectedStoredPath
    );
    if (committed) this.reset();
    return committed;
  }

  finishOpen() {
    if (!this.builder || this.builder.anchorCount() < 2) return false;
    const finished = this.restoreAuthoredStyle(this.builder.finishOpen());
    if (!this.preview(finished)) return false;
    return this.commit();
  }

  undoLastAnchor() {
    if (!this.builder || this.gesture) return false;
    if (this.builder.anchorCount() <= 1) return this.cancel();
    const path = this.builder.undoLastAnchor();
    return path ? this.preview(path) : false;
  }

  cancel() {
    if (!this.builder) return false;
    const transaction = this.transaction;
    this.reset();
    return transaction === 'mutation'
      ? this.documents.cancelPathMutation()
      : this.documents.cancelPathCreation();
  }

  resumePath(
    layerId: LayerId,
    path: VectorPath,
    subpathId: string,
    direction: PenPathDirection,
    pathToDocument: AffineMatrix
  ) {
    if (this.builder || this.gesture) return false;
    const documentToPath = invertMatrix(pathToDocument);
    if (!documentToPath) return false;
    if (!this.documents.beginPathMutation(layerId, path.id)) return false;
    try {
      this.authoredStyle = cloneVectorStyle(path.style);
      const draft = this.withoutArtworkPaint(path);
      this.builder = PenPathBuilder.resume(draft, subpathId, this.ids, direction);
      this.layerId = layerId;
      this.documentToPath = { ...documentToPath };
      this.pathToDocument = { ...pathToDocument };
      this.transaction = 'mutation';
      this.existingLayerId = layerId;
      if (!this.preview(draft)) throw new Error('The open path could not enter Pen editing mode.');
      return true;
    } catch (error) {
      this.documents.cancelPathMutation();
      this.reset();
      throw error;
    }
  }

  isActive() {
    return this.builder !== null;
  }

  /** Drops only an unfinished pointer-down gesture; placed anchors remain. */
  cancelPointerGesture() {
    if (!this.gesture) return false;
    this.gesture = null;
    this.presentedPath = this.builder?.snapshot() ?? null;
    this.presentationRevision += 1;
    return true;
  }

  snapshot(): PenToolSnapshot {
    return {
      layerId: this.layerId,
      path: this.presentedPath ?? this.builder?.snapshot() ?? null,
      pathToDocument: { ...this.pathToDocument },
      activeSubpathId: this.builder?.activeSubpathId() ?? null,
      activeEndpoint: this.builder?.activeEndpoint() ?? null,
      presentationRevision: this.presentationRevision,
      anchorGestureActive: Boolean(this.gesture),
      closingAnchorId: this.gesture?.kind === 'close' ? this.gesture.anchorId : null
    };
  }

  rubberBand(position: Vec2): PenRubberBand | null {
    if (!this.builder || this.gesture) return null;
    const path = this.builder.snapshot();
    const subpath = path.subpaths.find(({ id }) => id === this.builder!.activeSubpathId());
    const anchor = this.builder.activeEndpoint() === 'append'
      ? subpath?.anchors[subpath.anchors.length - 1]
      : subpath?.anchors[0];
    if (!anchor) return null;
    return {
      from: transformPoint(this.pathToDocument, anchor.position),
      to: { ...position }
    };
  }

  dispose() {
    this.cancel();
  }

  private openPath() {
    const openingDocument = this.documents.currentDocument();
    const openingTarget = openingDocument
      ? findDocumentLayer(openingDocument, openingDocument.activeLayerId)
      : null;
    this.existingLayerId = openingTarget?.type === 'vector'
      && !layerIsLocked(openingTarget, 'pixels') ? openingTarget.id : null;
    this.authoredStyle = cloneVectorStyle(this.style());
    const builder = PenPathBuilder.start(
      this.ids,
      this.pathName,
      { ...cloneVectorStyle(this.authoredStyle), fill: null, stroke: null }
    );
    const placement = this.documents.beginPathCreation(builder.snapshot(), this.layerName);
    if (!placement) {
      this.existingLayerId = null;
      return false;
    }
    this.builder = new PenPathBuilder(
      placement.path,
      builder.activeSubpathId(),
      this.ids
    );
    this.layerId = placement.layerId;
    this.documentToPath = { ...placement.documentToPath };
    this.pathToDocument = { ...placement.pathToDocument };
    this.transaction = 'creation';
    this.presentedPath = this.builder.snapshot();
    this.presentationRevision += 1;
    return true;
  }

  private preview(path: VectorPath) {
    const previewed = this.transaction === 'mutation'
      ? this.documents.previewPathMutation(() => path)
      : this.documents.previewPathCreation(path);
    if (previewed) {
      this.presentedPath = path;
      this.presentationRevision += 1;
      return true;
    }
    this.reset();
    return false;
  }

  private commit() {
    const operation = this.transaction === 'mutation' ? 'update' : 'create';
    const layerId = this.layerId;
    const pathId = this.presentedPath?.id ?? this.builder?.snapshot().id;
    const existingLayerId = this.existingLayerId;
    const committed = operation === 'update'
      ? this.documents.commitPathMutation()
      : this.documents.commitPathCreation();
    if (committed && layerId && pathId) {
      const document = this.documents.currentDocument();
      const layer = document ? findDocumentLayer(document, layerId) : null;
      const path = layer?.type === 'vector'
        ? layer.elements.find((element): element is VectorPath => (
            element.type === 'path' && element.id === pathId
          ))
        : null;
      if (layer?.type === 'vector' && path) this.onCommitted?.({
        operation,
        layerId,
        layerName: layer.name,
        path: cloneVectorPath(path),
        ...(existingLayerId ? { existingLayerId } : {})
      });
    }
    this.reset();
    return committed;
  }

  private reset() {
    this.builder = null;
    this.layerId = null;
    this.gesture = null;
    this.documentToPath = identityAffineMatrix();
    this.pathToDocument = identityAffineMatrix();
    this.transaction = null;
    this.existingLayerId = null;
    this.authoredStyle = null;
    this.presentedPath = null;
  }

  /** Keeps provisional Pen geometry in the GPU editing overlay, not in artwork paint. */
  private withoutArtworkPaint(path: VectorPath): VectorPath {
    return {
      ...path,
      style: { ...cloneVectorStyle(path.style), fill: null, stroke: null },
      styleRevision: path.styleRevision + 1
    };
  }

  private restoreAuthoredStyle(path: VectorPath): VectorPath {
    if (!this.authoredStyle) return path;
    return {
      ...path,
      style: cloneVectorStyle(this.authoredStyle),
      styleRevision: path.styleRevision + 1
    };
  }
}
