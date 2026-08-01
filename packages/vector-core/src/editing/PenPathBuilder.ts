import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { cloneVectorPath } from '../model/clone';
import type { VectorAnchor, VectorPath } from '../model/types';
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

  constructor(path: VectorPath, subpathId: string, private readonly ids: VectorIdSource) {
    if (!path.subpaths.some(({ id }) => id === subpathId)) {
      throw new Error(`Unknown vector subpath ${subpathId}.`);
    }
    this.path = cloneVectorPath(path);
    this.subpathId = subpathId;
  }

  static start(ids: VectorIdSource, name = 'Path') {
    const pathId = ids.next('path');
    const subpathId = ids.next('subpath');
    return new PenPathBuilder(
      createVectorPath(pathId, name, [createSubpath(subpathId)]),
      subpathId,
      ids
    );
  }

  place(position: Vec2, options: PlaceAnchorOptions = {}) {
    this.assertOpen();
    const anchor = anchorFromGesture(this.ids.next('anchor'), position, options);
    this.path = appendAnchor(this.path, this.subpathId, anchor);
    return this.snapshot();
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

  private assertOpen() {
    if (this.finished) throw new Error('Pen path builder is already finished.');
  }
}

