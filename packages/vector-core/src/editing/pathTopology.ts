import { cloneVectorAnchor, cloneVectorSubpath } from '../model/clone';
import { invertMatrix, multiplyMatrices, transformPoint } from '../math/affine';
import type { AffineMatrix } from '../math/affine';
import type { VectorAnchor, VectorPath, VectorSubpath } from '../model/types';

export type SubpathEndpoint = 'start' | 'end';

export interface VectorPathEndpoint {
  subpathId: string;
  endpoint: SubpathEndpoint;
}

const reverseAnchor = (anchor: VectorAnchor): VectorAnchor => ({
  ...cloneVectorAnchor(anchor),
  // A reversed cubic enters an anchor through its former outgoing handle and
  // leaves through its former incoming handle.
  handleIn: anchor.handleOut ? { ...anchor.handleOut } : null,
  handleOut: anchor.handleIn ? { ...anchor.handleIn } : null
});

/**
 * Reverses traversal without changing the realized Bezier geometry.
 * Anchor ids and the subpath id remain stable so editor selections survive.
 */
export const reverseSubpath = (subpath: VectorSubpath): VectorSubpath => ({
  ...cloneVectorSubpath(subpath),
  anchors: [...subpath.anchors].reverse().map(reverseAnchor)
});

const orientEndpoint = (
  subpath: VectorSubpath,
  endpoint: SubpathEndpoint,
  desiredEndpoint: SubpathEndpoint
) => endpoint === desiredEndpoint
  ? cloneVectorSubpath(subpath)
  : reverseSubpath(subpath);

/**
 * Joins two open subpaths by connecting the requested endpoints.
 *
 * The first input owns the resulting id. Both endpoint anchors are retained:
 * the newly created segment runs from the first endpoint to the second. This
 * mirrors a Pen-tool connection and does not destructively average geometry.
 */
export const joinOpenSubpaths = (
  first: VectorSubpath,
  firstEndpoint: SubpathEndpoint,
  second: VectorSubpath,
  secondEndpoint: SubpathEndpoint
): VectorSubpath => {
  if (first.closed || second.closed) {
    throw new Error('Only open vector subpaths can be joined.');
  }
  if (first.anchors.length === 0 || second.anchors.length === 0) {
    throw new Error('Both vector subpaths need at least one anchor before joining.');
  }
  const anchorIds = new Set(first.anchors.map(({ id }) => id));
  const duplicate = second.anchors.find(({ id }) => anchorIds.has(id));
  if (duplicate) throw new Error(`Cannot join subpaths with duplicate anchor id ${duplicate.id}.`);

  const left = orientEndpoint(first, firstEndpoint, 'end');
  const right = orientEndpoint(second, secondEndpoint, 'start');
  return {
    id: first.id,
    closed: false,
    anchors: [...left.anchors, ...right.anchors]
  };
};

const transformAnchor = (anchor: VectorAnchor, transform: AffineMatrix): VectorAnchor => ({
  ...cloneVectorAnchor(anchor),
  position: transformPoint(transform, anchor.position),
  handleIn: anchor.handleIn ? transformPoint(transform, anchor.handleIn) : null,
  handleOut: anchor.handleOut ? transformPoint(transform, anchor.handleOut) : null
});

const transformSubpath = (subpath: VectorSubpath, transform: AffineMatrix): VectorSubpath => ({
  ...cloneVectorSubpath(subpath),
  anchors: subpath.anchors.map((anchor) => transformAnchor(anchor, transform))
});

const requireSubpath = (path: VectorPath, id: string) => {
  const subpath = path.subpaths.find((candidate) => candidate.id === id);
  if (!subpath) throw new Error(`Unknown vector subpath ${path.id}/${id}.`);
  return subpath;
};

const assertUniqueTopology = (subpaths: readonly VectorSubpath[]) => {
  const subpathIds = new Set<string>();
  const anchorIds = new Set<string>();
  for (const subpath of subpaths) {
    if (subpathIds.has(subpath.id)) {
      throw new Error(`Joined path contains duplicate subpath id ${subpath.id}.`);
    }
    subpathIds.add(subpath.id);
    for (const anchor of subpath.anchors) {
      if (anchorIds.has(anchor.id)) {
        throw new Error(`Joined path contains duplicate anchor id ${anchor.id}.`);
      }
      anchorIds.add(anchor.id);
    }
  }
};

/**
 * Connects endpoints while preserving the first path's local coordinate
 * system, transform, style and identity.
 *
 * When paths differ, all remaining subpaths from `second` are transferred as
 * well. Their local geometry is rebased through document space so deleting
 * the second path after this operation cannot discard compound geometry.
 */
export const joinVectorPathEndpoints = (
  first: VectorPath,
  firstReference: VectorPathEndpoint,
  second: VectorPath,
  secondReference: VectorPathEndpoint
): VectorPath => {
  const samePath = first.id === second.id;
  if (samePath && firstReference.subpathId === secondReference.subpathId) {
    throw new Error('Joining both endpoints of one subpath is a close operation.');
  }

  const firstSubpath = requireSubpath(first, firstReference.subpathId);
  let secondSubpaths: VectorSubpath[];
  if (samePath) {
    secondSubpaths = second.subpaths.map(cloneVectorSubpath);
  } else {
    const documentToFirst = invertMatrix(first.transform);
    if (!documentToFirst) {
      throw new Error(`Cannot join into vector path ${first.id} because its transform is not invertible.`);
    }
    const secondToFirst = multiplyMatrices(documentToFirst, second.transform);
    secondSubpaths = second.subpaths.map((subpath) => transformSubpath(subpath, secondToFirst));
  }
  const secondSubpath = secondSubpaths.find(({ id }) => id === secondReference.subpathId);
  if (!secondSubpath) throw new Error(`Unknown vector subpath ${second.id}/${secondReference.subpathId}.`);

  const joined = joinOpenSubpaths(
    firstSubpath,
    firstReference.endpoint,
    secondSubpath,
    secondReference.endpoint
  );
  const resultSubpaths = first.subpaths.flatMap((subpath) => {
    if (subpath.id === firstReference.subpathId) return [joined];
    if (samePath && subpath.id === secondReference.subpathId) return [];
    return [cloneVectorSubpath(subpath)];
  });
  if (!samePath) {
    resultSubpaths.push(...secondSubpaths.filter(({ id }) => id !== secondReference.subpathId));
  }
  assertUniqueTopology(resultSubpaths);
  return {
    ...first,
    transform: { ...first.transform },
    style: {
      ...first.style,
      fill: first.style.fill ? { ...first.style.fill, color: [...first.style.fill.color] } : null,
      stroke: first.style.stroke ? {
        ...first.style.stroke,
        paint: { ...first.style.stroke.paint, color: [...first.style.stroke.paint.color] },
        dash: [...first.style.stroke.dash]
      } : null
    },
    subpaths: resultSubpaths,
    geometryRevision: first.geometryRevision + 1
  };
};
