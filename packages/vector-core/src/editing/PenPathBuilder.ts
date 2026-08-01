import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { cloneVectorAnchor, cloneVectorPath, cloneVectorStyle } from '../model/clone';
import type { VectorAnchor, VectorPath, VectorStyle } from '../model/types';
import type { Vec2 } from '../math/vector';
import { appendAnchor, closeSubpath } from './pathMutations';

export interface VectorIdSource {
  next(kind: 'path' | 'subpath' | 'anchor'): string;
}

export interface PlaceAnchorOptions {
  /** Drag endpoint in path-local coordinates. Creates symmetric Bézier handles. */
  dragTo?: Vec2;
}

const anchorFromGesture = (
  id: string,
  position: Vec2,
  options: PlaceAnchorOptions
): VectorAnchor => {
  if (!options.dragTo) return createAnchor(id, position);
  const delta = {
    x: options.dragTo.x - position.x,
    y: options.dragTo.y - position.y
  };
  return createAnchor(id, position, {
    handleIn: { x: position.x - delta.x, y: position.y - delta.y },
    handleOut: { ...options.dragTo },
    mode: 'symmetric'
  });
};

/**
 * Pure path-construction state for Pen-like tools. It accepts path-local
 * coordinates only; viewport/document conversion belongs to the tool host.
 */
export class PenPathBuilder {
  private path: VectorPath;
  private readonly subpathId: string;
  private finished = false;
  private pendingAnchorId: string | null = null;

  constructor(path: VectorPath, subpathId: string, private readonly ids: VectorIdSource) {
    if (!path.subpaths.some(({ id }) => id === subpathId)) {
      throw new Error(`Unknown vector subpath ${subpathId}.`);
    }
    this.path = cloneVectorPath(path);
    this.subpathId = subpathId;
  }

  static start(ids: VectorIdSource, name = 'Path', style?: VectorStyle) {
    const pathId = ids.next('path');
    const subpathId = ids.next('subpath');
    const path = createVectorPath(pathId, name, [createSubpath(subpathId)]);
    if (style) path.style = cloneVectorStyle(style);
    return new PenPathBuilder(
      path,
      subpathId,
      ids
    );
  }

  place(position: Vec2, options: PlaceAnchorOptions = {}) {
    this.assertOpen();
    const anchor = anchorFromGesture(this.takePendingAnchorId(), position, options);
    this.path = appendAnchor(this.path, this.subpathId, anchor);
    return this.snapshot();
  }

  /** Returns a stable provisional anchor without mutating the authored path. */
  previewPlace(position: Vec2, options: PlaceAnchorOptions = {}) {
    this.assertOpen();
    const anchor = anchorFromGesture(this.getPendingAnchorId(), position, options);
    return appendAnchor(this.path, this.subpathId, anchor);
  }

  close() {
    this.assertOpen();
    this.path = closeSubpath(this.path, this.subpathId);
    this.finished = true;
    return this.snapshot();
  }

  finishOpen() {
    this.assertOpen();
    this.finished = true;
    return this.snapshot();
  }

  snapshot() {
    return cloneVectorPath(this.path);
  }

  anchorCount() {
    return this.path.subpaths.find(({ id }) => id === this.subpathId)?.anchors.length ?? 0;
  }

  firstAnchor(): VectorAnchor | null {
    const anchor = this.path.subpaths.find(({ id }) => id === this.subpathId)?.anchors[0];
    return anchor ? cloneVectorAnchor(anchor) : null;
  }

  private assertOpen() {
    if (this.finished) throw new Error('Pen path builder is already finished.');
  }

  private getPendingAnchorId() {
    this.pendingAnchorId ??= this.ids.next('anchor');
    return this.pendingAnchorId;
  }

  private takePendingAnchorId() {
    const id = this.getPendingAnchorId();
    this.pendingAnchorId = null;
    return id;
  }
}
