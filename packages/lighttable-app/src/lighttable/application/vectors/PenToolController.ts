import {
  identityAffineMatrix,
  invertMatrix,
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

export interface PenToolControllerOptions {
  ids?: VectorIdSource;
  style?: () => VectorStyle;
  layerName?: string;
  pathName?: string;
}

export interface PenToolSnapshot {
  layerId: LayerId | null;
  path: VectorPath | null;
  anchorGestureActive: boolean;
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

  pointerMove(position: Vec2) {
    if (!this.builder || !this.gesture) return false;
    return this.preview(this.builder.previewPlace(this.gesture.position, {
      dragTo: transformPoint(this.documentToPath, position)
    }));
  }

  pointerUp(position: Vec2) {
    if (!this.builder || !this.gesture) return false;
    const start = this.gesture.position;
    this.gesture = null;
    const local = transformPoint(this.documentToPath, position);
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
    const closed = this.builder.close();
    if (!this.preview(closed)) return false;
    return this.commit();
  }

  finishOpen() {
    if (!this.builder || this.builder.anchorCount() < 2) return false;
    const finished = this.builder.finishOpen();
    if (!this.preview(finished)) return false;
    return this.commit();
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
      this.builder = PenPathBuilder.resume(path, subpathId, this.ids, direction);
      this.layerId = layerId;
      this.documentToPath = { ...documentToPath };
      this.pathToDocument = { ...pathToDocument };
      this.transaction = 'mutation';
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
      path: this.builder?.snapshot() ?? null,
      anchorGestureActive: Boolean(this.gesture)
    };
  }

  dispose() {
    this.cancel();
  }

  private openPath() {
    const builder = PenPathBuilder.start(this.ids, this.pathName, this.style());
    const layerId = this.documents.beginPathCreation(builder.snapshot(), this.layerName);
    if (!layerId) return false;
    this.builder = builder;
    this.layerId = layerId;
    this.documentToPath = identityAffineMatrix();
    this.pathToDocument = identityAffineMatrix();
    this.transaction = 'creation';
    return true;
  }

  private preview(path: VectorPath) {
    const previewed = this.transaction === 'mutation'
      ? this.documents.previewPathMutation(() => path)
      : this.documents.previewPathCreation(path);
    if (previewed) return true;
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
  }
}
