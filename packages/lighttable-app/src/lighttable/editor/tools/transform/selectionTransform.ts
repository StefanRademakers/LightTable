import type { Rect } from '../../document/documentTypes';
import type { SelectionOperation, SelectionShape } from '../../selection/selectionTypes';
import { transformPoint, type TransformPoint } from './affine';
import type { AffineMatrix } from './transformTypes';

const ellipsePoints = (shape: SelectionShape, segments = 48): TransformPoint[] => {
  const first = shape.points[0];
  const last = shape.points[shape.points.length - 1];
  const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const radius = { x: Math.abs(last.x - first.x) / 2, y: Math.abs(last.y - first.y) / 2 };
  return Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius.x,
      y: center.y + Math.sin(angle) * radius.y
    };
  });
};

const shapeOutline = (shape: SelectionShape): TransformPoint[] => {
  if (shape.kind === 'free' || shape.kind === 'polygon') return shape.points;
  if (shape.kind === 'ellipse') return ellipsePoints(shape);
  const first = shape.points[0];
  const last = shape.points[shape.points.length - 1];
  return [
    { x: first.x, y: first.y },
    { x: last.x, y: first.y },
    { x: last.x, y: last.y },
    { x: first.x, y: last.y }
  ];
};

export const transformSelectionOperations = (
  operations: SelectionOperation[],
  matrix: AffineMatrix
): SelectionOperation[] => operations.map((operation) => operation.mode === 'feather'
  ? {
      ...operation,
      shape: { ...operation.shape, points: operation.shape.points.map((point) => ({ ...point })) }
    }
  : {
      ...operation,
      shape: {
        kind: 'free',
        points: shapeOutline(operation.shape).map((point) => transformPoint(matrix, point))
      }
    });

export const selectionOperationsBounds = (
  operations: SelectionOperation[],
  fallback: Rect
): Rect => {
  const points = operations
    .filter((operation) => operation.mode !== 'feather')
    .flatMap((operation) => shapeOutline(operation.shape));
  if (!points.length) return fallback;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const left = Math.max(fallback.x, Math.min(...xs));
  const top = Math.max(fallback.y, Math.min(...ys));
  const right = Math.min(fallback.x + fallback.width, Math.max(...xs));
  const bottom = Math.min(fallback.y + fallback.height, Math.max(...ys));
  if (right <= left || bottom <= top) return fallback;
  return { x: left, y: top, width: right - left, height: bottom - top };
};
