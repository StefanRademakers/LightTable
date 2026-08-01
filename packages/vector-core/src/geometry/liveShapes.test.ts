import { describe, expect, it } from 'vitest';
import { createVectorLiveShape } from '../model/factories';
import { realizeLiveShape, resolvedRectangleCornerRadii } from './liveShapes';

describe('live shape realization', () => {
  it('realizes a rectangle while preserving live geometry as authority', () => {
    const shape = createVectorLiveShape('shape', {
      kind: 'rectangle', width: 100, height: 50,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    const path = realizeLiveShape(shape);
    expect(shape.geometry).toEqual({
      kind: 'rectangle', width: 100, height: 50,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    expect(path.subpaths[0].closed).toBe(true);
    expect(path.subpaths[0].anchors.map((anchor) => anchor.position)).toEqual([
      { x: 100, y: 0 }, { x: 100, y: 50 },
      { x: 0, y: 50 }, { x: 0, y: 0 }
    ]);
  });

  it('scales excessive corner radii without changing their ratios', () => {
    expect(resolvedRectangleCornerRadii({
      kind: 'rectangle', width: 100, height: 50,
      cornerRadii: [80, 40, 20, 10], linkedCorners: false
    })).toEqual([
      44.44444444444444,
      22.22222222222222,
      11.11111111111111,
      5.555555555555555
    ]);
  });

  it('realizes an ellipse with four smooth cubic anchors', () => {
    const shape = createVectorLiveShape('ellipse', { kind: 'ellipse', width: 120, height: 80 });
    const path = realizeLiveShape(shape);
    expect(path.subpaths[0].anchors.map((anchor) => anchor.position)).toEqual([
      { x: 60, y: 0 }, { x: 120, y: 40 }, { x: 60, y: 80 }, { x: 0, y: 40 }
    ]);
    expect(path.subpaths[0].anchors.every((anchor) => anchor.mode === 'smooth')).toBe(true);
  });

  it('propagates render revisions, style and transform to derived geometry', () => {
    const shape = createVectorLiveShape('ellipse', { kind: 'ellipse', width: 20, height: 10 });
    shape.geometryRevision = 4;
    shape.transformRevision = 5;
    shape.styleRevision = 6;
    shape.transform.tx = 30;
    shape.style.opacity = 0.4;
    const path = realizeLiveShape(shape);
    expect(path).toMatchObject({
      geometryRevision: 4, transformRevision: 5, styleRevision: 6,
      transform: { tx: 30 }, style: { opacity: 0.4 }
    });
    expect(path.style).not.toBe(shape.style);
  });

  it('realizes triangle and polygon geometry with stable vertex order', () => {
    const triangle = realizeLiveShape(createVectorLiveShape('triangle', {
      kind: 'triangle', width: 100, height: 80, cornerRadius: 0
    }));
    expect(triangle.subpaths[0].anchors.map((anchor) => anchor.position)).toEqual([
      { x: 50, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }
    ]);

    const polygon = realizeLiveShape(createVectorLiveShape('polygon', {
      kind: 'polygon', sides: 4, radius: 20, rotationRadians: 0, cornerRadius: 0
    }));
    expect(polygon.subpaths[0].anchors).toHaveLength(4);
    expect(polygon.subpaths[0].anchors.map((anchor) => anchor.position)).toEqual([
      { x: 20, y: 0 },
      { x: 20 * Math.cos(Math.PI / 2), y: 20 },
      { x: -20, y: 20 * Math.sin(Math.PI) },
      { x: 20 * Math.cos(Math.PI * 1.5), y: -20 }
    ]);
  });

  it('realizes rounded polygon corners as bounded cubic anchor pairs', () => {
    const polygon = realizeLiveShape(createVectorLiveShape('rounded-polygon', {
      kind: 'polygon', sides: 6, radius: 30, rotationRadians: 0, cornerRadius: 100
    }));
    expect(polygon.subpaths[0].anchors).toHaveLength(12);
    expect(polygon.subpaths[0].anchors.every((anchor) => anchor.mode === 'smooth')).toBe(true);
    expect(polygon.subpaths[0].anchors.every((anchor) => (
      Number.isFinite(anchor.position.x) && Number.isFinite(anchor.position.y)
    ))).toBe(true);
  });

  it('realizes stars with alternating outer and inner radii', () => {
    const star = realizeLiveShape(createVectorLiveShape('star', {
      kind: 'star', points: 5, outerRadius: 50, innerRadius: 20,
      rotationRadians: 0, cornerRadius: 0
    }));
    const radii = star.subpaths[0].anchors.map((anchor) => Math.hypot(anchor.position.x, anchor.position.y));
    expect(radii).toHaveLength(10);
    radii.forEach((radius, index) => expect(radius).toBeCloseTo(index % 2 === 0 ? 50 : 20));
  });

  it('realizes an open line and independent closed arrowhead outlines', () => {
    const line = realizeLiveShape(createVectorLiveShape('arrow', {
      kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
      startArrow: { width: 20, length: 30, concavity: 0 },
      endArrow: { width: 16, length: 24, concavity: 0.5 }
    }));
    expect(line.subpaths).toHaveLength(3);
    expect(line.subpaths[0]).toMatchObject({ closed: false });
    expect(line.subpaths[0].anchors.map((anchor) => anchor.position)).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }
    ]);
    expect(line.subpaths.slice(1).every((subpath) => subpath.closed && subpath.anchors.length === 4)).toBe(true);
  });
});
