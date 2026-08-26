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
): SelectionOperation[] => operations.map((operation) => (
  operation.mode === 'feather' || operation.mode === 'border' || operation.mode === 'smooth'
    || operation.mode === 'expand' || operation.mode === 'contract'
)
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
  let points: TransformPoint[] = [];
  operations.forEach((operation) => {
    if (operation.mode === 'feather' || operation.mode === 'border'
      || operation.mode === 'smooth' || operation.mode === 'expand'
      || operation.mode === 'contract') return;
    if (operation.mode === 'transform' && operation.transform) {
      points = points.map((point) => transformPoint(operation.transform!, point));
      return;
    }
    const outline = shapeOutline(operation.shape);
    if (operation.mode === 'replace') points = outline;
    else if (operation.mode === 'add') points.push(...outline);
    // Subtraction cannot enlarge support. Keep intersection conservative;
    // exact raster coverage remains renderer-owned.
    else if (operation.mode === 'intersect' && points.length === 0) points = outline;
    else if (operation.mode === 'invert') points = outline;
  });
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

/**
 * Complete non-zero support needed by clipboard crops and compositor
 * invalidation. Transform gizmos deliberately use the tighter geometry
 * bounds; pixel operations must retain the feather tail outside that contour.
 */
export const selectionOperationsSupportBounds = (
  operations: SelectionOperation[],
  fallback: Rect
): Rect => {
  const core = selectionOperationsBounds(operations, fallback);
  const support = operations.reduce((sum, operation) => {
    const amount = Math.max(0, operation.amount ?? 0);
    if (operation.mode === 'replace' || operation.mode === 'add'
      || operation.mode === 'subtract' || operation.mode === 'intersect') return sum + amount * 2;
    if (operation.mode === 'feather') return sum + amount * 2;
    if (operation.mode === 'expand' || operation.mode === 'smooth') return sum + amount;
    if (operation.mode === 'border') return sum + Math.ceil(amount / 2) + 2;
    return sum;
  }, 0);
  if (support <= 0) return core;
  // The authored feather radius controls the Gaussian shape, not a crop
  // threshold. At exactly one radius the finite kernel still has measurable
  // coverage, which becomes an obvious rectangular edge once an OS clipboard
  // image is cropped and pasted over a contrasting background. Retain two
  // radii plus a texel for resampling so exported alpha has settled to zero.
  // This only expands pixel/export support; selection and transform gizmos
  // continue to use the tight geometry bounds above.
  const padding = Math.ceil(support) + 1;
  const left = Math.max(fallback.x, Math.floor(core.x) - padding);
  const top = Math.max(fallback.y, Math.floor(core.y) - padding);
  const right = Math.min(fallback.x + fallback.width, Math.ceil(core.x + core.width) + padding);
  const bottom = Math.min(fallback.y + fallback.height, Math.ceil(core.y + core.height) + padding);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
};
