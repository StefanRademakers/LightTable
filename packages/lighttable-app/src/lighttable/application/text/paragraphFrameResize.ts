import type { Rect } from '@lighttable/text-core';
import type { VectorSelectionHandleKind } from '@lighttable/vector-rendering';
import {
  invertMatrix,
  transformPoint,
  type AffineMatrix,
  type Vec2
} from '../../editor/geometry/affine';

export type ParagraphFrameHandleKind = Exclude<VectorSelectionHandleKind, 'rotate'>;

export interface ParagraphFrameHandle {
  readonly kind: ParagraphFrameHandleKind;
  readonly point: Vec2;
}

const midpoint = (first: Vec2, second: Vec2): Vec2 => ({
  x: (first.x + second.x) * 0.5,
  y: (first.y + second.y) * 0.5
});

export const paragraphFrameHandles = (
  frame: Rect,
  localToDocument: AffineMatrix
): readonly ParagraphFrameHandle[] => {
  const northWest = transformPoint(localToDocument, { x: frame.x, y: frame.y });
  const northEast = transformPoint(localToDocument, {
    x: frame.x + frame.width, y: frame.y
  });
  const southEast = transformPoint(localToDocument, {
    x: frame.x + frame.width, y: frame.y + frame.height
  });
  const southWest = transformPoint(localToDocument, {
    x: frame.x, y: frame.y + frame.height
  });
  return [
    { kind: 'north-west', point: northWest },
    { kind: 'north', point: midpoint(northWest, northEast) },
    { kind: 'north-east', point: northEast },
    { kind: 'east', point: midpoint(northEast, southEast) },
    { kind: 'south-east', point: southEast },
    { kind: 'south', point: midpoint(southEast, southWest) },
    { kind: 'south-west', point: southWest },
    { kind: 'west', point: midpoint(southWest, northWest) }
  ];
};

export const hitTestParagraphFrameHandle = (
  frame: Rect,
  localToDocument: AffineMatrix,
  documentPoint: Vec2,
  radius: number
): ParagraphFrameHandle | null => {
  if (!(radius >= 0) || !Number.isFinite(radius)) return null;
  let nearest: ParagraphFrameHandle | null = null;
  let nearestDistanceSquared = radius ** 2;
  for (const handle of paragraphFrameHandles(frame, localToDocument)) {
    const distanceSquared = (documentPoint.x - handle.point.x) ** 2
      + (documentPoint.y - handle.point.y) ** 2;
    if (distanceSquared <= nearestDistanceSquared) {
      nearest = handle;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
};

export const resizeParagraphFrame = (
  openingFrame: Rect,
  handle: ParagraphFrameHandleKind,
  documentPoint: Vec2,
  localToDocument: AffineMatrix,
  minimumSize = 1
): Rect | null => {
  if (!(minimumSize > 0) || !Number.isFinite(minimumSize)) {
    throw new RangeError('Paragraph frame minimum size must be finite and greater than zero.');
  }
  const documentToLocal = invertMatrix(localToDocument);
  if (!documentToLocal) return null;
  const point = transformPoint(documentToLocal, documentPoint);
  const right = openingFrame.x + openingFrame.width;
  const bottom = openingFrame.y + openingFrame.height;
  let left = openingFrame.x;
  let top = openingFrame.y;
  let nextRight = right;
  let nextBottom = bottom;

  if (handle.includes('west')) left = Math.min(point.x, right - minimumSize);
  if (handle.includes('east')) nextRight = Math.max(point.x, left + minimumSize);
  if (handle.includes('north')) top = Math.min(point.y, bottom - minimumSize);
  if (handle.includes('south')) nextBottom = Math.max(point.y, top + minimumSize);

  return {
    x: left,
    y: top,
    width: nextRight - left,
    height: nextBottom - top
  };
};
