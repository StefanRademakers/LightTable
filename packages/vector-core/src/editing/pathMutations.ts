import { distance, normalize, scale, subtract } from '../math/vector';
import type { Vec2 } from '../math/vector';
import { cloneVectorAnchor, cloneVectorPath } from '../model/clone';
import type { AnchorMode, VectorAnchor, VectorPath } from '../model/types';
import { segmentAt } from '../model/segments';

export interface AnchorReference {
  subpathId: string;
  anchorId: string;
}

export type HandleKind = 'in' | 'out';

const incrementGeometryRevision = (path: VectorPath): VectorPath => ({
  ...path,
  geometryRevision: path.geometryRevision + 1
});

const updateAnchor = (
  path: VectorPath,
  reference: AnchorReference,
  mutate: (anchor: VectorAnchor) => VectorAnchor
) => {
  let found = false;
  const next = cloneVectorPath(path);
  next.subpaths = next.subpaths.map((subpath) => {
    if (subpath.id !== reference.subpathId) return subpath;
    return {
      ...subpath,
      anchors: subpath.anchors.map((anchor) => {
        if (anchor.id !== reference.anchorId) return anchor;
        found = true;
        return mutate(cloneVectorAnchor(anchor));
      })
    };
  });
  if (!found) throw new Error(`Unknown vector anchor ${reference.subpathId}/${reference.anchorId}.`);
  return incrementGeometryRevision(next);
};

export const moveAnchors = (
  path: VectorPath,
  references: readonly AnchorReference[],
  delta: Vec2
) => {
  if (references.length === 0 || (delta.x === 0 && delta.y === 0)) return path;
  const selected = new Set(references.map(({ subpathId, anchorId }) => `${subpathId}\0${anchorId}`));
  const next = cloneVectorPath(path);
  let changed = false;
  next.subpaths = next.subpaths.map((subpath) => ({
    ...subpath,
    anchors: subpath.anchors.map((anchor) => {
      if (!selected.has(`${subpath.id}\0${anchor.id}`)) return anchor;
      changed = true;
      const translate = (point: Vec2 | null) => point
        ? { x: point.x + delta.x, y: point.y + delta.y }
        : null;
      return {
        ...anchor,
        position: translate(anchor.position)!,
        handleIn: translate(anchor.handleIn),
        handleOut: translate(anchor.handleOut)
      };
    })
  }));
  if (!changed) throw new Error('None of the selected vector anchors exist.');
  return incrementGeometryRevision(next);
};

export const moveAnchorHandle = (
  path: VectorPath,
  reference: AnchorReference,
  handle: HandleKind,
  position: Vec2
) => updateAnchor(path, reference, (anchor) => {
  const movedKey = handle === 'in' ? 'handleIn' : 'handleOut';
  const oppositeKey = handle === 'in' ? 'handleOut' : 'handleIn';
  const originalOpposite = anchor[oppositeKey];
  anchor[movedKey] = { ...position };

  if (anchor.mode === 'symmetric') {
    const delta = subtract(position, anchor.position);
    anchor[oppositeKey] = {
      x: anchor.position.x - delta.x,
      y: anchor.position.y - delta.y
    };
  } else if (anchor.mode === 'smooth' && originalOpposite) {
    const oppositeLength = distance(originalOpposite, anchor.position);
    const direction = normalize(subtract(anchor.position, position));
    const offset = scale(direction, oppositeLength);
    anchor[oppositeKey] = {
      x: anchor.position.x + offset.x,
      y: anchor.position.y + offset.y
    };
  }
  return anchor;
});

/**
 * Pulls one cubic segment through a requested point delta while its end
 * anchors remain fixed. Moving both adjacent controls by delta / (B1 + B2)
 * makes the cubic point at t follow the pointer exactly.
 */
export const moveSegmentPoint = (
  path: VectorPath,
  subpathId: string,
  segmentIndex: number,
  t: number,
  delta: Vec2
) => {
  if (delta.x === 0 && delta.y === 0) return path;
  if (!(t > 0 && t < 1)) throw new RangeError('Segment drag t must be strictly between zero and one.');
  const subpath = path.subpaths.find(({ id }) => id === subpathId);
  if (!subpath) throw new Error(`Unknown vector subpath ${subpathId}.`);
  const segment = segmentAt(subpath, segmentIndex);
  const influence = 3 * t * (1 - t);
  if (influence <= 1e-6) throw new RangeError('Segment drag is too close to an anchor.');
  const controlDelta = { x: delta.x / influence, y: delta.y / influence };
  const movedStart = moveAnchorHandle(
    path,
    { subpathId, anchorId: segment.startAnchorId },
    'out',
    { x: segment.p1.x + controlDelta.x, y: segment.p1.y + controlDelta.y }
  );
  const moved = moveAnchorHandle(
    movedStart,
    { subpathId, anchorId: segment.endAnchorId },
    'in',
    { x: segment.p2.x + controlDelta.x, y: segment.p2.y + controlDelta.y }
  );
  return { ...moved, geometryRevision: path.geometryRevision + 1 };
};

export const setAnchorMode = (
  path: VectorPath,
  reference: AnchorReference,
  mode: AnchorMode
) => updateAnchor(path, reference, (anchor) => {
  anchor.mode = mode;
  if (mode === 'corner') return anchor;

  const source = anchor.handleOut ?? anchor.handleIn;
  if (!source) return anchor;
  const sourceDelta = subtract(source, anchor.position);
  const sourceLength = Math.sqrt(sourceDelta.x ** 2 + sourceDelta.y ** 2);
  const inLength = mode === 'symmetric'
    ? sourceLength
    : anchor.handleIn ? distance(anchor.handleIn, anchor.position) : sourceLength;
  const outLength = mode === 'symmetric'
    ? sourceLength
    : anchor.handleOut ? distance(anchor.handleOut, anchor.position) : sourceLength;
  const outDirection = anchor.handleOut
    ? normalize(subtract(anchor.handleOut, anchor.position))
    : normalize(subtract(anchor.position, anchor.handleIn!));
  anchor.handleOut = {
    x: anchor.position.x + outDirection.x * outLength,
    y: anchor.position.y + outDirection.y * outLength
  };
  anchor.handleIn = {
    x: anchor.position.x - outDirection.x * inLength,
    y: anchor.position.y - outDirection.y * inLength
  };
  return anchor;
});

/** Converts an anchor into a true corner by removing both direction handles. */
export const convertAnchorToCorner = (
  path: VectorPath,
  reference: AnchorReference
) => updateAnchor(path, reference, (anchor) => ({
  ...anchor,
  mode: 'corner',
  handleIn: null,
  handleOut: null
}));

/**
 * Creates a symmetric handle pair from an anchor to a dragged local point.
 * This is the canonical mutation used by a Convert Point drag gesture.
 */
export const setSymmetricAnchorHandles = (
  path: VectorPath,
  reference: AnchorReference,
  handleOut: Vec2
) => updateAnchor(path, reference, (anchor) => {
  const delta = subtract(handleOut, anchor.position);
  return {
    ...anchor,
    mode: 'symmetric',
    handleOut: { ...handleOut },
    handleIn: {
      x: anchor.position.x - delta.x,
      y: anchor.position.y - delta.y
    }
  };
});

export const appendAnchor = (
  path: VectorPath,
  subpathId: string,
  anchor: VectorAnchor
) => {
  if (path.subpaths.some((subpath) => subpath.anchors.some(({ id }) => id === anchor.id))) {
    throw new Error(`Anchor id ${anchor.id} already exists in path ${path.id}.`);
  }
  const next = cloneVectorPath(path);
  const subpath = next.subpaths.find(({ id }) => id === subpathId);
  if (!subpath) throw new Error(`Unknown vector subpath ${subpathId}.`);
  subpath.anchors.push(cloneVectorAnchor(anchor));
  return incrementGeometryRevision(next);
};

export const closeSubpath = (path: VectorPath, subpathId: string) => {
  const next = cloneVectorPath(path);
  const subpath = next.subpaths.find(({ id }) => id === subpathId);
  if (!subpath) throw new Error(`Unknown vector subpath ${subpathId}.`);
  if (subpath.closed) return path;
  if (subpath.anchors.length < 2) throw new Error('A subpath needs at least two anchors before closing.');
  subpath.closed = true;
  return incrementGeometryRevision(next);
};

export const deleteAnchors = (
  path: VectorPath,
  references: readonly AnchorReference[]
) => {
  if (references.length === 0) return path;
  const selected = new Set(references.map(({ subpathId, anchorId }) => `${subpathId}\0${anchorId}`));
  const next = cloneVectorPath(path);
  let removed = 0;
  next.subpaths = next.subpaths.flatMap((subpath) => {
    const anchors = subpath.anchors.filter((anchor) => {
      const remove = selected.has(`${subpath.id}\0${anchor.id}`);
      if (remove) removed += 1;
      return !remove;
    });
    if (anchors.length === 0) return [];
    return [{ ...subpath, closed: subpath.closed && anchors.length >= 2, anchors }];
  });
  if (removed === 0) throw new Error('None of the selected vector anchors exist.');
  return incrementGeometryRevision(next);
};
