import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { multiplyMatrices, scaleMatrix, transformPoint, translationMatrix } from '../math/affine';
import { segmentAt } from '../model/segments';
import {
  joinOpenSubpaths,
  joinVectorPathEndpoints,
  reverseSubpath,
  type SubpathEndpoint
} from './pathTopology';

const curved = () => createSubpath('curve', [
  createAnchor('a', { x: 0, y: 0 }, {
    handleIn: { x: -4, y: -3 },
    handleOut: { x: 10, y: 20 },
    mode: 'smooth'
  }),
  createAnchor('b', { x: 30, y: 10 }, {
    handleIn: { x: 20, y: 25 },
    handleOut: { x: 35, y: 5 },
    mode: 'smooth'
  })
]);

describe('vector path topology', () => {
  it('reverses traversal while preserving exact cubic geometry', () => {
    const source = curved();
    const original = segmentAt(source, 0);
    const reversed = reverseSubpath(source);
    const segment = segmentAt(reversed, 0);

    expect(reversed.id).toBe(source.id);
    expect(reversed.anchors.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(segment).toMatchObject({
      p0: original.p3,
      p1: original.p2,
      p2: original.p1,
      p3: original.p0
    });
    expect(source.anchors.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  for (const [firstEndpoint, secondEndpoint, expected] of [
    ['end', 'start', ['a', 'b', 'c', 'd']],
    ['start', 'start', ['b', 'a', 'c', 'd']],
    ['end', 'end', ['a', 'b', 'd', 'c']],
    ['start', 'end', ['b', 'a', 'd', 'c']]
  ] as const satisfies readonly (readonly [SubpathEndpoint, SubpathEndpoint, readonly string[]])[]) {
    it(`joins ${firstEndpoint} to ${secondEndpoint} with deterministic orientation`, () => {
      const first = createSubpath('first', [
        createAnchor('a', { x: 0, y: 0 }, { handleOut: { x: 2, y: 0 } }),
        createAnchor('b', { x: 10, y: 0 }, { handleIn: { x: 8, y: 0 } })
      ]);
      const second = createSubpath('second', [
        createAnchor('c', { x: 20, y: 0 }, { handleOut: { x: 22, y: 0 } }),
        createAnchor('d', { x: 30, y: 0 }, { handleIn: { x: 28, y: 0 } })
      ]);

      const joined = joinOpenSubpaths(first, firstEndpoint, second, secondEndpoint);
      expect(joined).toMatchObject({ id: 'first', closed: false });
      expect(joined.anchors.map(({ id }) => id)).toEqual(expected);
      expect(first.anchors.map(({ id }) => id)).toEqual(['a', 'b']);
      expect(second.anchors.map(({ id }) => id)).toEqual(['c', 'd']);
    });
  }

  it('rejects closed, empty, and identity-colliding inputs', () => {
    expect(() => joinOpenSubpaths(
      { ...curved(), closed: true }, 'end', curved(), 'start'
    )).toThrow('Only open');
    expect(() => joinOpenSubpaths(
      createSubpath('empty'), 'end', curved(), 'start'
    )).toThrow('at least one anchor');
    expect(() => joinOpenSubpaths(
      curved(), 'end', curved(), 'start'
    )).toThrow('duplicate anchor id');
  });

  it('joins subpaths inside one path without disturbing sibling order', () => {
    const path = createVectorPath('compound', 'Compound', [
      createSubpath('first', [createAnchor('a', { x: 0, y: 0 })]),
      createSubpath('untouched', [createAnchor('x', { x: 50, y: 50 })]),
      createSubpath('second', [createAnchor('b', { x: 10, y: 0 })])
    ]);
    const result = joinVectorPathEndpoints(
      path,
      { subpathId: 'first', endpoint: 'end' },
      path,
      { subpathId: 'second', endpoint: 'start' }
    );

    expect(result.subpaths.map(({ id }) => id)).toEqual(['first', 'untouched']);
    expect(result.subpaths[0].anchors.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result.subpaths[1]).toEqual(path.subpaths[1]);
    expect(result.geometryRevision).toBe(1);
  });

  it('rebases all geometry from a second transformed path into the first path', () => {
    const first = createVectorPath('first-path', 'First', [
      createSubpath('first', [createAnchor('a', { x: 0, y: 0 })])
    ]);
    first.transform = multiplyMatrices(translationMatrix(100, 20), scaleMatrix(2, 2));
    const second = createVectorPath('second-path', 'Second', [
      createSubpath('second', [createAnchor('b', { x: 5, y: 7 }, {
        handleIn: { x: 3, y: 6 }
      })]),
      createSubpath('sibling', [createAnchor('c', { x: 40, y: 30 })])
    ]);
    second.transform = multiplyMatrices(translationMatrix(-15, 60), scaleMatrix(0.5, 3));
    const originalDocumentPoints = second.subpaths.flatMap((subpath) =>
      subpath.anchors.map((anchor) => transformPoint(second.transform, anchor.position))
    );

    const result = joinVectorPathEndpoints(
      first,
      { subpathId: 'first', endpoint: 'end' },
      second,
      { subpathId: 'second', endpoint: 'start' }
    );
    const transferredDocumentPoints = result.subpaths.flatMap((subpath) =>
      subpath.anchors
        .filter(({ id }) => id === 'b' || id === 'c')
        .map((anchor) => transformPoint(result.transform, anchor.position))
    );

    expect(transferredDocumentPoints).toHaveLength(2);
    transferredDocumentPoints.forEach((point, index) => {
      expect(point.x).toBeCloseTo(originalDocumentPoints[index].x, 10);
      expect(point.y).toBeCloseTo(originalDocumentPoints[index].y, 10);
    });
    expect(result.transform).toEqual(first.transform);
    expect(result.style).toEqual(first.style);
    expect(result.subpaths.map(({ id }) => id)).toEqual(['first', 'sibling']);
  });

  it('refuses same-subpath closure and a non-invertible destination transform', () => {
    const path = createVectorPath('path', 'Path', [curved()]);
    expect(() => joinVectorPathEndpoints(
      path,
      { subpathId: 'curve', endpoint: 'start' },
      path,
      { subpathId: 'curve', endpoint: 'end' }
    )).toThrow('close operation');

    const singular = createVectorPath('singular', 'Singular', [
      createSubpath('first', [createAnchor('first-anchor', { x: 0, y: 0 })])
    ]);
    singular.transform = scaleMatrix(0, 1);
    const second = createVectorPath('second', 'Second', [
      createSubpath('second', [createAnchor('second-anchor', { x: 1, y: 1 })])
    ]);
    expect(() => joinVectorPathEndpoints(
      singular,
      { subpathId: 'first', endpoint: 'end' },
      second,
      { subpathId: 'second', endpoint: 'start' }
    )).toThrow('not invertible');
  });
});
