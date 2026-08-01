import { describe, expect, it } from 'vitest';
import { transformPoint } from '@lighttable/vector-core';
import {
  beginVectorElementScaleGesture,
  vectorElementScaleOperation
} from './vectorElementTransformGesture';

describe('vector element transform gestures', () => {
  it('scales a corner around its opposite corner', () => {
    const gesture = beginVectorElementScaleGesture(
      { x: 10, y: 20, width: 40, height: 20 },
      'south-east'
    );
    const operation = vectorElementScaleOperation(gesture, { x: 90, y: 80 });
    expect(gesture.pivot).toEqual({ x: 10, y: 20 });
    expect(transformPoint(operation, { x: 50, y: 40 })).toEqual({ x: 90, y: 80 });
    expect(transformPoint(operation, gesture.pivot)).toEqual(gesture.pivot);
  });

  it('keeps the orthogonal axis stable for an edge handle', () => {
    const gesture = beginVectorElementScaleGesture(
      { x: 10, y: 20, width: 40, height: 20 },
      'east'
    );
    const operation = vectorElementScaleOperation(gesture, { x: 70, y: -100 });
    expect(transformPoint(operation, { x: 50, y: 40 })).toEqual({ x: 70, y: 40 });
  });

  it('can preserve aspect ratio for corner scaling', () => {
    const gesture = beginVectorElementScaleGesture(
      { x: 0, y: 0, width: 20, height: 10 },
      'south-east'
    );
    const operation = vectorElementScaleOperation(gesture, { x: 30, y: 12 }, true);
    expect(transformPoint(operation, { x: 20, y: 10 })).toEqual({ x: 30, y: 15 });
  });
});
