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
  return {
    value: multiplyMatrices(translationMatrix(snap.offsetX, snap.offsetY), proposed),
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
