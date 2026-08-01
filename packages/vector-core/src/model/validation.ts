import { isFiniteAffineMatrix } from '../math/affine';
import type { VectorLiveShape, VectorPath } from './types';

export interface VectorValidationIssue {
  code: string;
  message: string;
  path: string;
}

export const validateVectorPath = (path: VectorPath): VectorValidationIssue[] => {
  const issues: VectorValidationIssue[] = [];
  const ids = new Set<string>();
  const claim = (id: string, location: string) => {
    if (!id) issues.push({ code: 'empty-id', message: 'Vector ids must not be empty.', path: location });
    else if (ids.has(id)) issues.push({ code: 'duplicate-id', message: `Duplicate vector id ${id}.`, path: location });
    ids.add(id);
  };
  claim(path.id, 'id');
  if (!isFiniteAffineMatrix(path.transform)) {
    issues.push({ code: 'invalid-transform', message: 'Path transform contains a non-finite value.', path: 'transform' });
  }
  path.subpaths.forEach((subpath, subpathIndex) => {
    claim(subpath.id, `subpaths[${subpathIndex}].id`);
    subpath.anchors.forEach((anchor, anchorIndex) => {
      const location = `subpaths[${subpathIndex}].anchors[${anchorIndex}]`;
      claim(anchor.id, `${location}.id`);
      for (const [name, point] of [
        ['position', anchor.position], ['handleIn', anchor.handleIn], ['handleOut', anchor.handleOut]
      ] as const) {
        if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) {
          issues.push({ code: 'invalid-point', message: `${name} contains a non-finite value.`, path: `${location}.${name}` });
        }
      }
    });
  });
  return issues;
};

export const validateVectorLiveShape = (shape: VectorLiveShape): VectorValidationIssue[] => {
  const issues: VectorValidationIssue[] = [];
  if (!shape.id) issues.push({ code: 'empty-id', message: 'Vector ids must not be empty.', path: 'id' });
  if (!isFiniteAffineMatrix(shape.transform)) {
    issues.push({ code: 'invalid-transform', message: 'Shape transform contains a non-finite value.', path: 'transform' });
  }
  const dimensions = shape.geometry.kind === 'rectangle'
    ? [shape.geometry.width, shape.geometry.height, ...shape.geometry.cornerRadii]
    : shape.geometry.kind === 'ellipse'
      ? [shape.geometry.width, shape.geometry.height]
      : shape.geometry.kind === 'triangle'
        ? [shape.geometry.width, shape.geometry.height, shape.geometry.cornerRadius]
        : shape.geometry.kind === 'polygon'
          ? [shape.geometry.radius, shape.geometry.cornerRadius]
          : shape.geometry.kind === 'star'
            ? [shape.geometry.outerRadius, shape.geometry.innerRadius, shape.geometry.cornerRadius]
            : [];
  const invalidLine = shape.geometry.kind === 'line' && (
    [shape.geometry.start.x, shape.geometry.start.y, shape.geometry.end.x, shape.geometry.end.y]
      .some((value) => !Number.isFinite(value))
    || [shape.geometry.startArrow, shape.geometry.endArrow].some((arrow) => arrow && (
      !Number.isFinite(arrow.width) || arrow.width < 0
      || !Number.isFinite(arrow.length) || arrow.length < 0
      || !Number.isFinite(arrow.concavity) || arrow.concavity < -1 || arrow.concavity > 1
    ))
  );
  const invalidRotation = (shape.geometry.kind === 'polygon' || shape.geometry.kind === 'star')
    && !Number.isFinite(shape.geometry.rotationRadians);
  if (invalidLine || invalidRotation || dimensions.some((value) => !Number.isFinite(value) || value < 0)) {
    issues.push({
      code: 'invalid-live-shape-dimension',
      message: 'Live-shape dimensions and radii must be finite and non-negative.',
      path: 'geometry'
    });
  }
  if ((shape.geometry.kind === 'polygon'
      && (!Number.isInteger(shape.geometry.sides) || shape.geometry.sides < 3 || shape.geometry.sides > 4096))
    || (shape.geometry.kind === 'star'
      && (!Number.isInteger(shape.geometry.points) || shape.geometry.points < 3 || shape.geometry.points > 2048))) {
    issues.push({
      code: 'invalid-live-shape-points',
      message: 'Polygons and stars require a bounded integral point count of at least three.',
      path: 'geometry'
    });
  }
  return issues;
};
