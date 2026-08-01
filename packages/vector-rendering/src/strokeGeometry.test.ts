import { describe, expect, it } from 'vitest';
import { createAnchor, createSubpath, createVectorPath, type VectorStroke } from '@lighttable/vector-core';
import { realizeVectorPath } from './realizePath';
import { buildStrokeTriangleGeometry, strokeRuns } from './strokeGeometry';

const stroke = (overrides: Partial<VectorStroke> = {}): VectorStroke => ({
  paint: { type: 'solid', color: [1, 0, 0, 1] },
  width: 10,
  cap: 'butt',
  join: 'miter',
  miterLimit: 4,
  dash: [],
  dashOffset: 0,
  ...overrides
});

const line = () => realizeVectorPath(createVectorPath('line', 'Line', [createSubpath('s', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 100, y: 0 })
])]), 0.25);

describe('stroke geometry', () => {
  it('creates a two-triangle butt-capped segment', () => {
    const geometry = buildStrokeTriangleGeometry(line(), stroke());
    expect(geometry.triangleCount).toBe(2);
    expect([...geometry.vertices]).toEqual([
      0, 5, 0, -5, 100, 5,
      0, -5, 100, -5, 100, 5
    ]);
  });

  it('adds cap geometry without changing the source realization', () => {
    const source = line();
    expect(buildStrokeTriangleGeometry(source, stroke({ cap: 'square' })).triangleCount).toBe(6);
    expect(buildStrokeTriangleGeometry(source, stroke({ cap: 'round' })).triangleCount).toBeGreaterThan(10);
    expect(source.subpaths[0].points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('splits dash patterns and honors their offset', () => {
    const subpath = line().subpaths[0];
    expect(strokeRuns(subpath, [20, 10], 0).map((run) => run.points)).toEqual([
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      [{ x: 30, y: 0 }, { x: 50, y: 0 }],
      [{ x: 60, y: 0 }, { x: 80, y: 0 }],
      [{ x: 90, y: 0 }, { x: 100, y: 0 }]
    ]);
    expect(strokeRuns(subpath, [20, 10], 10)[0].points).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }
    ]);
  });

  it('supports miter, bevel, and round joins', () => {
    const corner = realizeVectorPath(createVectorPath('corner', 'Corner', [createSubpath('s', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 50, y: 0 }),
      createAnchor('c', { x: 50, y: 50 })
    ])]), 0.25);
    expect(buildStrokeTriangleGeometry(corner, stroke({ join: 'bevel' })).triangleCount).toBe(5);
    expect(buildStrokeTriangleGeometry(corner, stroke({ join: 'miter' })).triangleCount).toBe(5);
    expect(buildStrokeTriangleGeometry(corner, stroke({ join: 'round' })).triangleCount).toBeGreaterThan(5);
  });
});
