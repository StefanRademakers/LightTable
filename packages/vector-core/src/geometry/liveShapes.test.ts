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
});
