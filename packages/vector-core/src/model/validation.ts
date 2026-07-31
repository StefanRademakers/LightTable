import { isFiniteAffineMatrix } from '../math/affine';
import type { VectorPath } from './types';

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
