import { describe, expect, it } from 'vitest';
import { rotationMatrix, translationMatrix, multiplyMatrices } from './affine';
import { buildTransformEditingFrame, transformCornerRotationTargets } from './transformEditingFrame';
import type { TransformSessionState } from './transformTypes';
import type { LayerId } from '../../document/documentTypes';

describe('buildTransformEditingFrame', () => {
  it('uses the real transformed layer quad instead of its axis-aligned bounds', () => {
    const sourceMatrix = multiplyMatrices(
      translationMatrix(40, 25),
      rotationMatrix(Math.PI / 2)
    );
    const state: TransformSessionState = {
      layerId: 'layer-1' as LayerId,
      sourceBounds: { x: 20, y: 25, width: 20, height: 30 },
      supportBounds: { x: 20, y: 25, width: 20, height: 30 },
      sourceContentBounds: { x: 0, y: 0, width: 30, height: 20 },
      sourceMatrix,
      matrix: translationMatrix(5, 7),
      projectiveQuad: null,
      sourceKind: 'layer',
      previewKind: 'raster'
    };

    const frame = buildTransformEditingFrame(state, 1);
    const expected = [
      [45, 32, 45, 62],
      [45, 62, 25, 62],
      [25, 62, 25, 32],
      [25, 32, 45, 32]
    ];
    frame.edges.slice(0, 4).forEach((edge, index) => {
      expect([
        edge.start.x,
        edge.start.y,
        edge.end.x,
        edge.end.y
      ]).toEqual(expected[index].map((value) => expect.closeTo(value)));
    });
    expect(frame.edges).toHaveLength(5);
    expect(frame.edges[4]?.start).toEqual({ x: 45, y: 47 });
  });
});

describe('transformCornerRotationTargets', () => {
  it('keeps the target offset fixed in screen pixels at every zoom level', () => {
    const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const first = transformCornerRotationTargets(corners, { x: 50, y: 50 }, 1, 20)[0];
    const zoomed = transformCornerRotationTargets(corners, { x: 50, y: 50 }, 2, 20)[0];
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(20);
    expect(Math.hypot(zoomed.x, zoomed.y) * 2).toBeCloseTo(20);
  });
});
