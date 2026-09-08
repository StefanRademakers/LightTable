import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type {
  SelectionOperation,
  SelectionPoint,
  SelectionShape,
} from '../../../editor/selection/selectionTypes';

interface CommittedSelectionHitSource {
  getSelection(): SelectionOperation[];
  getSelectionMaskSnapshot(): SelectionMaskSnapshot | null;
}

const pointInShape = (shape: SelectionShape, point: SelectionPoint): boolean => {
  if (shape.points.length < 2) return false;
  if (shape.kind === 'rectangle') {
    const [first, last] = shape.points;
    return point.x >= Math.min(first.x, last.x) && point.x <= Math.max(first.x, last.x)
      && point.y >= Math.min(first.y, last.y) && point.y <= Math.max(first.y, last.y);
  }
  if (shape.kind === 'ellipse') {
    const [first, last] = shape.points;
    const rx = Math.abs(last.x - first.x) / 2;
    const ry = Math.abs(last.y - first.y) / 2;
    if (rx < 1e-6 || ry < 1e-6) return false;
    const cx = (first.x + last.x) / 2;
    const cy = (first.y + last.y) / 2;
    return ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1;
  }
  let inside = false;
  const points = shape.points;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const first = points[index];
    const second = points[previous];
    if (((first.y > point.y) !== (second.y > point.y))
      && point.x < (second.x - first.x) * (point.y - first.y)
        / (second.y - first.y || 1e-12) + first.x) inside = !inside;
  }
  return inside;
};

const semanticSelectionContainsPoint = (
  operations: readonly SelectionOperation[],
  point: SelectionPoint,
): boolean => {
  let sample = (_point: SelectionPoint) => false;
  operations.forEach((operation) => {
    const previous = sample;
    if (operation.mode === 'transform' && operation.transform) {
      const matrix = operation.transform;
      const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
      if (Math.abs(determinant) < 1e-8) return;
      sample = (target) => previous({
        x: (matrix.d * (target.x - matrix.tx) - matrix.c * (target.y - matrix.ty)) / determinant,
        y: (-matrix.b * (target.x - matrix.tx) + matrix.a * (target.y - matrix.ty)) / determinant,
      });
      return;
    }
    if (operation.mode === 'feather' || operation.mode === 'border'
      || operation.mode === 'smooth' || operation.mode === 'expand'
      || operation.mode === 'contract' || operation.source?.kind === 'similar') return;
    if (operation.mode === 'invert') {
      sample = (target) => !previous(target);
      return;
    }
    const shapeSample = operation.source
      ? (_target: SelectionPoint) => false
      : (target: SelectionPoint) => pointInShape(operation.shape, target);
    sample = operation.mode === 'replace'
      ? shapeSample
      : operation.mode === 'add'
        ? (target) => previous(target) || shapeSample(target)
        : operation.mode === 'subtract'
          ? (target) => previous(target) && !shapeSample(target)
          : (target) => previous(target) && shapeSample(target);
  });
  return sample(point);
};

/** Exact mask is authoritative; semantic replay exists only for unmigrated hosts. */
export const committedSelectionContainsPoint = (
  source: CommittedSelectionHitSource,
  point: SelectionPoint,
): boolean => {
  const operations = source.getSelection();
  const snapshot = source.getSelectionMaskSnapshot();
  if (snapshot && (snapshot.active || operations.length === 0)) {
    return snapshot.contains(point.x, point.y);
  }
  return semanticSelectionContainsPoint(operations, point);
};
