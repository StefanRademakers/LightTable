import { transformPoint, translationMatrix, multiplyMatrices, type TransformPoint } from './affine';
import type { AffineMatrix, TransformQuad } from './transformTypes';
import {
  solveSnap,
  type SnapFeature,
  type SnapMatch,
  type SnapRect
} from '../../../application/tools/snapping/snapEngine';

const boundsForPoints = (points: readonly TransformPoint[]): SnapRect => {
  const left = Math.min(...points.map(({ x }) => x));
  const top = Math.min(...points.map(({ y }) => y));
  const right = Math.max(...points.map(({ x }) => x));
  const bottom = Math.max(...points.map(({ y }) => y));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export interface SnappedTransformTranslation<T> {
  value: T;
  matches: readonly SnapMatch[];
}

const isTranslationOnly = (matrix: AffineMatrix, epsilon = 1e-6) =>
  Math.abs(matrix.a - 1) <= epsilon
  && Math.abs(matrix.b) <= epsilon
  && Math.abs(matrix.c) <= epsilon
  && Math.abs(matrix.d - 1) <= epsilon;

const pixelAlignTranslation = (matrix: AffineMatrix): AffineMatrix => (
  isTranslationOnly(matrix)
    ? { ...matrix, tx: Math.round(matrix.tx), ty: Math.round(matrix.ty) }
    : matrix
);

/**
 * Resolves a body drag from its immutable drag-start geometry. Keeping this
 * outside React prevents pointer-event frequency from changing the result.
 */
export const snapAffineTranslation = (
  sourcePoints: readonly TransformPoint[],
  startMatrix: AffineMatrix,
  delta: TransformPoint,
  targets: readonly SnapFeature[],
  zoom: number,
  enabled: boolean,
  bypass: boolean
): SnappedTransformTranslation<AffineMatrix> => {
  const proposed = multiplyMatrices(translationMatrix(delta.x, delta.y), startMatrix);
  const snap = solveSnap({
    movingBounds: boundsForPoints(sourcePoints.map((point) => transformPoint(proposed, point))),
    targets,
    zoom,
    enabled,
    bypass
  });
  const resolved = multiplyMatrices(translationMatrix(snap.offsetX, snap.offsetY), proposed);
  return {
    // A translation-only transform must land on document pixels. Otherwise a
    // raster layer is presented through the linear compositor at fractional
    // coordinates and appears progressively softer despite unchanged source
    // pixels. Scale, rotation and shear deliberately retain subpixel freedom.
    value: pixelAlignTranslation(resolved),
    matches: snap.matches
  };
};

export const snapProjectiveTranslation = (
  source: TransformQuad,
  delta: TransformPoint,
  targets: readonly SnapFeature[],
  zoom: number,
  enabled: boolean,
  bypass: boolean
): SnappedTransformTranslation<TransformQuad> => {
  const proposed = source.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y
  })) as unknown as TransformQuad;
  const snap = solveSnap({
    movingBounds: boundsForPoints(proposed),
    targets,
    zoom,
    enabled,
    bypass
  });
  return {
    value: proposed.map((point) => ({
      x: point.x + snap.offsetX,
      y: point.y + snap.offsetY
    })) as unknown as TransformQuad,
    matches: snap.matches
  };
};
