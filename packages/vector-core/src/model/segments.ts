import type { CubicSegment, VectorSubpath } from './types';

export const segmentCount = (subpath: VectorSubpath) => {
  if (subpath.anchors.length < 2) return 0;
  return subpath.closed ? subpath.anchors.length : subpath.anchors.length - 1;
};

export const segmentAt = (subpath: VectorSubpath, segmentIndex: number): CubicSegment => {
  const count = segmentCount(subpath);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= count) {
    throw new RangeError(`Segment index ${segmentIndex} is outside 0..${Math.max(0, count - 1)}.`);
  }
  const start = subpath.anchors[segmentIndex];
  const end = subpath.anchors[(segmentIndex + 1) % subpath.anchors.length];
  return {
    startAnchorId: start.id,
    endAnchorId: end.id,
    p0: start.position,
    p1: start.handleOut ?? start.position,
    p2: end.handleIn ?? end.position,
    p3: end.position
  };
};

export function* segmentsOf(subpath: VectorSubpath): Generator<CubicSegment, void> {
  for (let index = 0; index < segmentCount(subpath); index += 1) {
    yield segmentAt(subpath, index);
  }
}
