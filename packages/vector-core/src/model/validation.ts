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
    : [shape.geometry.width, shape.geometry.height];
  if (dimensions.some((value) => !Number.isFinite(value) || value < 0)) {
    issues.push({
      code: 'invalid-live-shape-dimension',
      message: 'Live-shape dimensions and radii must be finite and non-negative.',
      path: 'geometry'
    });
  }
  return issues;
};
