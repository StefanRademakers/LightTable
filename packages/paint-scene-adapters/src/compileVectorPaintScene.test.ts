import { describe, expect, it } from 'vitest';
import { createVectorLiveShape, type VectorPath } from '@lighttable/vector-core';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { compileVectorPaintScene } from './compileVectorPaintScene';

const path = (): VectorPath => ({
  id: 'curve', type: 'path', name: 'Curve', fillRule: 'evenodd',
  transform: { a: 2, b: 0, c: 0, d: 2, tx: 4, ty: 5 },
  geometryRevision: 2, transformRevision: 3, styleRevision: 4,
  style: { fill: { type: 'solid', color: [1, 0, 0, 0.5] }, stroke: null, opacity: 0.5 },
  subpaths: [{
    id: 'subpath', closed: true,
    anchors: [
      { id: 'a', position: { x: 0, y: 0 }, handleIn: { x: -1, y: 0 }, handleOut: { x: 1, y: 0 }, mode: 'smooth' },
      { id: 'b', position: { x: 4, y: 0 }, handleIn: { x: 3, y: 0 }, handleOut: null, mode: 'corner' }
    ]
  }]
});

describe('compileVectorPaintScene', () => {
  it('preserves cubic closing geometry, transforms and revision keys', () => {
    const result = compileVectorPaintScene([path()], { sourceId: 'doc', sourceRevision: '9' });
    expect(result.status).toBe('ready');
    expect(result.scene.fragments[0].revisionKey).toBe('2:3:4');
    expect(result.scene.fragments[0].paths[0]).toMatchObject({
      stableId: 'curve:path', revisionKey: '2',
      commands: [
        { kind: 'move', x: 0, y: 0 },
        { kind: 'cubic', control1X: 1, control1Y: 0, control2X: 3, control2Y: 0, x: 4, y: 0 },
        { kind: 'cubic', control1X: 4, control1Y: 0, control2X: -1, control2Y: 0, x: 0, y: 0 },
        { kind: 'close' }
      ]
    });
    expect(result.scene.fragments[0].commands[0]).toMatchObject({
      kind: 'fill-path', fillRule: 'evenodd', transform: [2, 0, 0, 2, 4, 5],
      paint: { kind: 'solid', color: [1, 0, 0, 0.25] },
      pathId: 'curve:path'
    });
  });

  it('reports gradients instead of silently reducing or dropping them', () => {
    const value = path();
    value.style.fill = {
      kind: 'gradient', shape: 'linear', coordinateSpace: 'object-bounds',
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      reverse: false, dither: false, interpolation: 'linear',
      asset: { id: 'g', name: 'g', type: 'solid', smoothness: 1, colorStops: [], opacityStops: [], roughness: 0, seed: 0 }
    };
    const result = compileVectorPaintScene([value], { sourceId: 'doc', sourceRevision: '10' });
    expect(result.status).toBe('unsupported');
    expect(result.issues).toEqual([expect.objectContaining({ feature: 'gradient-fill', fallback: 'current-backend' })]);
  });

  it('resolves a valid object-bounds gradient into scene space with a bounded sampled ramp', () => {
    const value = createVectorLiveShape('gradient-rect', {
      kind: 'rectangle', width: 10, height: 20,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    value.transform = { a: 2, b: 0, c: 0, d: 3, tx: 4, ty: 5 };
    value.style.fill = createDefaultGradientPaint('gradient');

    const result = compileVectorPaintScene([value], {
      sourceId: 'doc', sourceRevision: '11'
    });

    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
    const command = result.scene.fragments[0].commands[0];
    expect(command).toMatchObject({
      kind: 'fill-path',
      transform: [2, 0, 0, 3, 4, 5],
      paint: { kind: 'gradient', shape: 'linear', transform: [20, 0, 0, 60, 4, 35] }
    });
    if (command.paint.kind !== 'gradient') throw new Error('Expected gradient fixture.');
    expect(command.paint.stops).toHaveLength(256);
    expect(command.paint.stops[0].color).toEqual([0, 0, 0, 1]);
    expect(command.paint.stops.at(-1)?.color).toEqual([1, 1, 1, 1]);
  });
});
