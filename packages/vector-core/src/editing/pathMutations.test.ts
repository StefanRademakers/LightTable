import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { PathMutationSession } from './PathMutationSession';
import { closeSubpath, deleteAnchors, moveAnchorHandle, moveAnchors, setAnchorMode } from './pathMutations';

const pathFixture = () => createVectorPath('path', 'Path', [createSubpath('subpath', [
  createAnchor('a', { x: 10, y: 10 }, {
    handleIn: { x: 5, y: 10 }, handleOut: { x: 15, y: 10 }, mode: 'smooth'
  }),
  createAnchor('b', { x: 30, y: 10 })
])]);

describe('path mutations', () => {
  it('moves anchors and their handles without mutating the source', () => {
    const source = pathFixture();
    const result = moveAnchors(source, [{ subpathId: 'subpath', anchorId: 'a' }], { x: 4, y: -2 });
    expect(source.subpaths[0].anchors[0].position).toEqual({ x: 10, y: 10 });
    expect(result.subpaths[0].anchors[0]).toMatchObject({
      position: { x: 14, y: 8 }, handleIn: { x: 9, y: 8 }, handleOut: { x: 19, y: 8 }
    });
    expect(result.geometryRevision).toBe(1);
  });

  it('preserves opposite handle length for smooth anchors', () => {
    const result = moveAnchorHandle(
      pathFixture(),
      { subpathId: 'subpath', anchorId: 'a' },
      'out',
      { x: 10, y: 20 }
    );
    expect(result.subpaths[0].anchors[0].handleIn).toEqual({ x: 10, y: 5 });
  });

  it('mirrors symmetric handles and can convert a corner to symmetric', () => {
    let path = pathFixture();
    path = setAnchorMode(path, { subpathId: 'subpath', anchorId: 'a' }, 'symmetric');
    path = moveAnchorHandle(path, { subpathId: 'subpath', anchorId: 'a' }, 'out', { x: 13, y: 14 });
    expect(path.subpaths[0].anchors[0].handleIn).toEqual({ x: 7, y: 6 });
  });

  it('closes and deletes anchors with explicit path revisions', () => {
    const closed = closeSubpath(pathFixture(), 'subpath');
    expect(closed.subpaths[0].closed).toBe(true);
    const deleted = deleteAnchors(closed, [{ subpathId: 'subpath', anchorId: 'b' }]);
    expect(deleted.subpaths[0]).toMatchObject({ closed: false });
    expect(deleted.subpaths[0].anchors.map(({ id }) => id)).toEqual(['a']);
    expect(deleted.geometryRevision).toBe(2);
  });
});

describe('PathMutationSession', () => {
  it('coalesces arbitrary preview updates into one reversible commit', () => {
    const session = new PathMutationSession(pathFixture());
    session.update((path) => moveAnchors(path, [{ subpathId: 'subpath', anchorId: 'a' }], { x: 1, y: 0 }));
    session.update((path) => moveAnchors(path, [{ subpathId: 'subpath', anchorId: 'a' }], { x: 8, y: 0 }));
    const commit = session.commit();
    expect(commit?.before.subpaths[0].anchors[0].position.x).toBe(10);
    expect(commit?.after.subpaths[0].anchors[0].position.x).toBe(18);
    expect(() => session.commit()).toThrow('already finished');
  });

  it('returns the exact opening geometry when cancelled', () => {
    const session = new PathMutationSession(pathFixture());
    session.update((path) => moveAnchors(path, [{ subpathId: 'subpath', anchorId: 'a' }], { x: 8, y: 0 }));
    expect(session.cancel()).toEqual(pathFixture());
  });
});
