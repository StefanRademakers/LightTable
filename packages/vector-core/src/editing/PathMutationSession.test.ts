import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { moveAnchors } from './pathMutations';
import { PathMutationSession } from './PathMutationSession';

describe('PathMutationSession', () => {
  it('gives successive drag previews unique GPU cache revisions while keeping one commit', () => {
    const path = createVectorPath('path', 'Path', [createSubpath('subpath', [
      createAnchor('anchor', { x: 10, y: 20 }),
      createAnchor('end', { x: 80, y: 20 })
    ])]);
    const session = new PathMutationSession(path);
    const reference = [{ subpathId: 'subpath', anchorId: 'anchor' }];

    const first = session.update((opening) => moveAnchors(opening, reference, { x: 5, y: 0 }));
    const second = session.update((opening) => moveAnchors(opening, reference, { x: 20, y: 10 }));

    expect(second.geometryRevision).toBeGreaterThan(first.geometryRevision);
    expect(second.subpaths[0]?.anchors[0]?.position).toEqual({ x: 30, y: 30 });
    expect(session.commit()).toMatchObject({
      before: { geometryRevision: path.geometryRevision },
      after: { geometryRevision: second.geometryRevision }
    });
  });
});
