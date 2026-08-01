import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath } from '../model/factories';
import { segmentAt } from '../model/segments';
import { reverseSubpath, joinOpenSubpaths, type SubpathEndpoint } from './pathTopology';

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
});
