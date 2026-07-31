import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { pathBounds, pointInPath } from './pathGeometry';

const rectanglePath = () => createVectorPath('path', 'Rectangle', [
  createSubpath('outer', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', { x: 100, y: 0 }),
    createAnchor('c', { x: 100, y: 100 }),
    createAnchor('d', { x: 0, y: 100 })
  ], true)
]);

describe('path geometry', () => {
  it('computes compound path bounds', () => {
    expect(pathBounds(rectanglePath())).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('classifies nonzero fill', () => {
    const path = rectanglePath();
    expect(pointInPath(path, { x: 50, y: 50 })).toBe(true);
    expect(pointInPath(path, { x: -1, y: 50 })).toBe(false);
  });

  it('supports even-odd holes independently of winding direction', () => {
    const path = rectanglePath();
    path.fillRule = 'evenodd';
    path.subpaths.push(createSubpath('hole', [
      createAnchor('e', { x: 25, y: 25 }),
      createAnchor('f', { x: 75, y: 25 }),
      createAnchor('g', { x: 75, y: 75 }),
      createAnchor('h', { x: 25, y: 75 })
    ], true));
    expect(pointInPath(path, { x: 10, y: 10 })).toBe(true);
    expect(pointInPath(path, { x: 50, y: 50 })).toBe(false);
  });
});
