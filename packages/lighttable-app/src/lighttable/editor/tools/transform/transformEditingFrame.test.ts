import { describe, expect, it } from 'vitest';
import { rotationMatrix, translationMatrix, multiplyMatrices } from './affine';
import { buildTransformEditingFrame } from './transformEditingFrame';
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
      sourceKind: 'layer'
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
  });
});
