import { describe, expect, it } from 'vitest';
import {
  add,
  createAnchor,
  createSubpath,
  createVectorPath,
  normalize,
  subtract,
  type VectorStroke
} from '@lighttable/vector-core';
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

const meshCovers = (vertices: Float32Array, point: { x: number; y: number }) => {
  const edge = (ax: number, ay: number, bx: number, by: number) =>
    (point.x - ax) * (by - ay) - (point.y - ay) * (bx - ax);
  for (let index = 0; index < vertices.length; index += 6) {
    const a = edge(vertices[index]!, vertices[index + 1]!, vertices[index + 2]!, vertices[index + 3]!);
    const b = edge(vertices[index + 2]!, vertices[index + 3]!, vertices[index + 4]!, vertices[index + 5]!);
    const c = edge(vertices[index + 4]!, vertices[index + 5]!, vertices[index]!, vertices[index + 1]!);
    if ((a >= -1e-4 && b >= -1e-4 && c >= -1e-4)
      || (a <= 1e-4 && b <= 1e-4 && c <= 1e-4)) return true;
  }
  return false;
};

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
    expect(buildStrokeTriangleGeometry(corner, stroke({ join: 'miter' })).triangleCount).toBe(6);
    expect(buildStrokeTriangleGeometry(corner, stroke({ join: 'round' })).triangleCount).toBeGreaterThan(5);
  });

  it('places closed-contour strokes inside, centered or outside the path', () => {
    const square = realizeVectorPath(createVectorPath('square', 'Square', [createSubpath('s', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 100, y: 0 }),
      createAnchor('c', { x: 100, y: 100 }),
      createAnchor('d', { x: 0, y: 100 })
    ], true)]), 0.25);
    const bounds = (alignment: VectorStroke['alignment']) => {
      const vertices = buildStrokeTriangleGeometry(square, stroke({ alignment })).vertices;
      const xs = [...vertices].filter((_, index) => index % 2 === 0);
      const ys = [...vertices].filter((_, index) => index % 2 === 1);
      return {
        minX: Math.min(...xs), minY: Math.min(...ys),
        maxX: Math.max(...xs), maxY: Math.max(...ys)
      };
    };

    expect(bounds('inside')).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(bounds('center')).toEqual({ minX: -5, minY: -5, maxX: 105, maxY: 105 });
    expect(bounds('outside')).toEqual({ minX: -10, minY: -10, maxX: 110, maxY: 110 });

    const rounded = buildStrokeTriangleGeometry(square, stroke({ join: 'round' })).vertices;
    const roundedPoints = Array.from({ length: rounded.length / 2 }, (_, index) => ({
      x: rounded[index * 2]!, y: rounded[index * 2 + 1]!
    }));
    expect(roundedPoints.some(({ x, y }) => x < 0 && y < 0)).toBe(true);
  });

  it.each(['miter', 'round'] as const)('connects every outer %s join without radial gaps', (join) => {
    const center = { x: 100, y: 100 };
    const anchors = Array.from({ length: 64 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return createAnchor(`p${index}`, {
        x: center.x + Math.cos(angle) * 80,
        y: center.y + Math.sin(angle) * 50
      });
    });
    const polygon = realizeVectorPath(createVectorPath('ring', 'Ring', [
      createSubpath('ring-outline', anchors, true)
    ]), 0.25);
    const vertices = buildStrokeTriangleGeometry(polygon, stroke({
      width: 20,
      alignment: 'outside',
      join
    })).vertices;
    const uncovered: number[] = [];
    polygon.subpaths[0]!.points.forEach((point, index, points) => {
      const previous = points[(index - 1 + points.length) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      const previousDirection = normalize(subtract(point, previous));
      const nextDirection = normalize(subtract(next, point));
      const previousOuter = { x: previousDirection.y, y: -previousDirection.x };
      const nextOuter = { x: nextDirection.y, y: -nextDirection.x };
      const bisector = normalize(add(previousOuter, nextOuter));
      const sample = { x: point.x + bisector.x * 18, y: point.y + bisector.y * 18 };
      if (!meshCovers(vertices, sample)) uncovered.push(index);
    });
    expect(uncovered).toEqual([]);
  });
});
