import { describe, expect, it } from 'vitest';
import {
  aroundPoint,
  identityMatrix,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  transformedBounds
} from './affine';
import {
  alignTransformFrameToDocument,
  appendTransformFrameOperation,
  pointInTransformFrame,
  transformSessionFrame
} from './transformSessionFrame';
import type { TransformSessionState } from './transformTypes';
import type { LayerId } from '../../document/documentTypes';

const stateFor = (sourceMatrix = identityMatrix()): TransformSessionState => ({
  layerId: 'layer-1' as LayerId,
  sourceBounds: transformedBounds(sourceMatrix, { x: 0, y: 0, width: 200, height: 100 }),
  supportBounds: transformedBounds(sourceMatrix, { x: 0, y: 0, width: 200, height: 100 }),
  sourceContentBounds: { x: 0, y: 0, width: 200, height: 100 },
  sourceMatrix,
  matrix: identityMatrix(),
  projectiveQuad: null,
  sourceKind: 'layer',
  previewKind: 'raster'
});

describe('transform session frame', () => {
  it('starts a confirmed transform in a new document-aligned frame by default', () => {
    const sourceMatrix = aroundPoint(rotationMatrix(Math.PI / 4), { x: 100, y: 50 });
    const frame = transformSessionFrame(stateFor(sourceMatrix), 'document');

    expect(frame.matrix).toEqual(identityMatrix());
    expect(frame.bounds).toEqual(transformedBounds(sourceMatrix, { x: 0, y: 0, width: 200, height: 100 }));
  });

  it('can preserve the confirmed local frame without inferring a matrix decomposition', () => {
    const sourceMatrix = aroundPoint(rotationMatrix(Math.PI / 4), { x: 100, y: 50 });
    const frame = transformSessionFrame(stateFor(sourceMatrix), 'local');

    expect(frame.matrix).toEqual(sourceMatrix);
    expect(frame.bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('appends resize in the temporary rotated frame instead of document axes', () => {
    const rotation = aroundPoint(rotationMatrix(Math.PI / 6), { x: 100, y: 50 });
    const scale = aroundPoint(scaleMatrix(1.5, 0.75), { x: 0, y: 0 });
    const nextSession = appendTransformFrameOperation(identityMatrix(), rotation, scale);

    expect(nextSession).not.toBeNull();
    const total = multiplyMatrices(nextSession!, rotation);
    const expected = multiplyMatrices(rotation, scale);
    for (const point of [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }]) {
      const result = transformPoint(total, point);
      const expectedPoint = transformPoint(expected, point);
      expect(result.x).toBeCloseTo(expectedPoint.x);
      expect(result.y).toBeCloseTo(expectedPoint.y);
    }
  });

  it('maps pointer coordinates through both the session and preserved frame', () => {
    const frame = aroundPoint(rotationMatrix(Math.PI / 5), { x: 100, y: 50 });
    const session = aroundPoint(scaleMatrix(1.25, 0.8), { x: 100, y: 50 });
    const local = { x: 175, y: 25 };
    const documentPoint = transformPoint(multiplyMatrices(session, frame), local);

    const result = pointInTransformFrame(session, frame, documentPoint);
    expect(result?.x).toBeCloseTo(local.x);
    expect(result?.y).toBeCloseTo(local.y);
  });

  it('aligns the edit frame to document axes without changing the rendered transform', () => {
    const sourceMatrix = aroundPoint(rotationMatrix(Math.PI / 4), { x: 100, y: 50 });
    const state = stateFor(sourceMatrix);
    const localFrame = transformSessionFrame(state, 'local');
    const aligned = alignTransformFrameToDocument(state, localFrame);

    expect(aligned).not.toBeNull();
    for (const key of Object.keys(identityMatrix()) as Array<keyof ReturnType<typeof identityMatrix>>) {
      expect(aligned!.matrix[key]).toBeCloseTo(identityMatrix()[key]);
    }
    expect(aligned!.bounds).toEqual(transformedBounds(sourceMatrix, state.sourceContentBounds));
  });
});
