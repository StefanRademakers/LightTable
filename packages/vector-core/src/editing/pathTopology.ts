import { cloneVectorAnchor, cloneVectorSubpath } from '../model/clone';
import type { VectorAnchor, VectorSubpath } from '../model/types';

export type SubpathEndpoint = 'start' | 'end';

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
