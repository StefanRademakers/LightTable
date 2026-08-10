import {
  identityAffineMatrix,
  invertMatrix,
  joinVectorPathEndpoints,
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
import type { LayerId } from '../../editor/document/documentTypes';
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

interface AnchorGesture {
  position: Vec2;
}

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
}

export interface PenToolSnapshot {
  layerId: LayerId | null;
  path: VectorPath | null;
  pathToDocument: AffineMatrix;
  activeSubpathId: string | null;
  activeEndpoint: PenPathDirection | null;
  presentationRevision: number;
  anchorGestureActive: boolean;
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
  private presentationRevision = 0;

  constructor(
    private readonly documents: VectorDocumentController,
    options: PenToolControllerOptions = {}
  ) {
    this.ids = options.ids ?? uuidIds;
    this.style = options.style ?? defaultPenStyle;
    this.layerName = options.layerName ?? 'Shape';
    this.pathName = options.pathName ?? 'Path';
  }

  pointerDown(position: Vec2) {
    if (this.gesture) return false;
    if (!this.builder && !this.openPath()) return false;
    this.gesture = { position: transformPoint(this.documentToPath, position) };
    return true;
  }

  pointerMove(position: Vec2, constrain = false) {
    if (!this.builder || !this.gesture) return false;
    const local = transformPoint(this.documentToPath, position);
    this.presentedPath = this.builder.previewPlace(this.gesture.position, {
      dragTo: constrain ? constrainDirection(this.gesture.position, local) : local
    });
    this.presentationRevision += 1;
    return true;
  }

  pointerUp(position: Vec2, constrain = false) {
    if (!this.builder || !this.gesture) return false;
    const start = this.gesture.position;
    this.gesture = null;
    const rawLocal = transformPoint(this.documentToPath, position);
    const local = constrain ? constrainDirection(start, rawLocal) : rawLocal;
    const dragTo = distanceSquared(start, local) > 0
      ? local
      : undefined;
    return this.preview(this.builder.place(start, { dragTo }));
  }

  /** Closes when the pointer is near the first anchor in document space. */
  tryClose(position: Vec2, tolerance: number) {
    const first = this.builder?.firstAnchor();
    if (!first || !this.builder || this.builder.anchorCount() < 3) return false;
    const firstDocument = transformPoint(this.pathToDocument, first.position);
    if (distanceSquared(firstDocument, position) > tolerance * tolerance) return false;
    const closed = this.restoreAuthoredStyle(this.builder.close());
    if (!this.preview(closed)) return false;
    return this.commit();
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
      anchorGestureActive: Boolean(this.gesture)
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
    this.authoredStyle = cloneVectorStyle(this.style());
    const builder = PenPathBuilder.start(
      this.ids,
      this.pathName,
      { ...cloneVectorStyle(this.authoredStyle), fill: null, stroke: null }
    );
    const placement = this.documents.beginPathCreation(builder.snapshot(), this.layerName);
    if (!placement) return false;
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
    const committed = this.transaction === 'mutation'
      ? this.documents.commitPathMutation()
      : this.documents.commitPathCreation();
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
