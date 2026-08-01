import {
  aroundPoint,
  scaleMatrix,
  type AffineMatrix,
  type Rect,
  type Vec2
} from '@lighttable/vector-core';
import type { VectorSelectionHandleKind } from '@lighttable/vector-rendering';

export interface VectorElementScaleGesture {
  handle: VectorSelectionHandleKind;
  pivot: Vec2;
  openingPoint: Vec2;
  affectsX: boolean;
  affectsY: boolean;
}

const handleAxes = (handle: VectorSelectionHandleKind) => ({
  affectsX: handle !== 'north' && handle !== 'south',
  affectsY: handle !== 'east' && handle !== 'west'
});

export const beginVectorElementScaleGesture = (
  bounds: Rect,
  handle: VectorSelectionHandleKind
): VectorElementScaleGesture => {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const centerX = (left + right) * 0.5;
  const centerY = (top + bottom) * 0.5;
  const west = handle.includes('west');
  const east = handle.includes('east');
  const north = handle.includes('north');
  const south = handle.includes('south');
  return {
    handle,
    pivot: {
      x: west ? right : east ? left : centerX,
      y: north ? bottom : south ? top : centerY
    },
    openingPoint: {
      x: west ? left : east ? right : centerX,
      y: north ? top : south ? bottom : centerY
    },
    ...handleAxes(handle)
  };
};

const safeRatio = (value: number, opening: number) => {
  if (Math.abs(opening) <= 1e-9) return 1;
  const ratio = value / opening;
  return Number.isFinite(ratio) ? ratio : 1;
};

/** Builds the document-space scale operation for one transform-frame drag. */
export const vectorElementScaleOperation = (
  gesture: VectorElementScaleGesture,
  documentPoint: Vec2,
  preserveAspect = false
): AffineMatrix => {
  const opening = {
    x: gesture.openingPoint.x - gesture.pivot.x,
    y: gesture.openingPoint.y - gesture.pivot.y
  };
  const current = {
    x: documentPoint.x - gesture.pivot.x,
    y: documentPoint.y - gesture.pivot.y
  };
  let x = gesture.affectsX ? safeRatio(current.x, opening.x) : 1;
  let y = gesture.affectsY ? safeRatio(current.y, opening.y) : 1;
  if (preserveAspect && gesture.affectsX && gesture.affectsY) {
    const uniform = Math.abs(x) >= Math.abs(y) ? x : y;
    x = uniform;
    y = uniform;
  }
  return aroundPoint(scaleMatrix(x, y), gesture.pivot);
};
