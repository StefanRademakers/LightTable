import { splitCubic } from '../geometry/bezier';
import { createAnchor } from '../model/factories';
import { segmentAt } from '../model/segments';
import type { VectorSubpath } from '../model/types';

export interface SplitSegmentResult {
  subpath: VectorSubpath;
  insertedAnchorId: string;
}

/** Exact De Casteljau insertion: rendered geometry is unchanged. */
export const insertAnchorOnSegment = (
  subpath: VectorSubpath,
  segmentIndex: number,
  t: number,
  insertedAnchorId: string
): SplitSegmentResult => {
  if (subpath.anchors.some(({ id }) => id === insertedAnchorId)) {
    throw new Error(`Anchor id ${insertedAnchorId} already exists in subpath ${subpath.id}.`);
  }
  if (!(t > 0 && t < 1)) throw new RangeError('Inserted anchor t must be strictly between zero and one.');
  const segment = segmentAt(subpath, segmentIndex);
  const split = splitCubic(segment, t);
  const anchors = subpath.anchors.map((anchor) => ({
    ...anchor,
    position: { ...anchor.position },
    handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
    handleOut: anchor.handleOut ? { ...anchor.handleOut } : null
  }));
  const startIndex = segmentIndex;
  const endIndex = (segmentIndex + 1) % anchors.length;
  anchors[startIndex].handleOut = split.left.p1;
  anchors[endIndex].handleIn = split.right.p2;
  const inserted = createAnchor(insertedAnchorId, split.point, {
    handleIn: split.left.p2,
    handleOut: split.right.p1,
    mode: 'smooth'
  });
  anchors.splice(startIndex + 1, 0, inserted);
  return { subpath: { ...subpath, anchors }, insertedAnchorId };
};
