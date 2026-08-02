import { describe, expect, it } from 'vitest';
import {
  buildVectorSelectionFrame,
  hitTestVectorSelectionFrameHandle,
  hitTestVectorSelectionFrameRotation
} from './selectionFrame';

describe('buildVectorSelectionFrame', () => {
  it('normalizes bounds and creates stable edge, handle and pivot geometry', () => {
    const frame = buildVectorSelectionFrame(
      { x: 30, y: 40, width: -20, height: 40 },
      { resourceKey: 'selection:1', handleSizePx: 10 }
    );

    expect(frame.bounds).toEqual({ x: 10, y: 40, width: 20, height: 40 });
    expect(frame.pivot).toEqual({ x: 20, y: 60 });
    expect(frame.edges).toHaveLength(4);
    expect(frame.handles).toHaveLength(8);
    expect(frame.handles.find(({ kind }) => kind === 'south-east')).toEqual({
      kind: 'south-east',
      point: { x: 30, y: 80 },
      markerSizePx: 10
    });
  });

  it('rejects invalid bounds and screen-space marker sizes', () => {
    expect(() => buildVectorSelectionFrame(
      { x: 0, y: 0, width: Number.NaN, height: 1 },
      { resourceKey: 'invalid' }
    )).toThrow('bounds must be finite');
    expect(() => buildVectorSelectionFrame(
      { x: 0, y: 0, width: 1, height: 1 },
      { resourceKey: 'invalid', handleSizePx: 0 }
    )).toThrow('handle size');
  });

  it('hit-tests the closest handle in document space', () => {
    const frame = buildVectorSelectionFrame(
      { x: 10, y: 20, width: 40, height: 30 },
      { resourceKey: 'selection:hit' }
    );
    expect(hitTestVectorSelectionFrameHandle(frame, { x: 49, y: 21 }, 3)?.kind)
      .toBe('north-east');
    expect(hitTestVectorSelectionFrameHandle(frame, { x: 30, y: 35 }, 3)).toBeNull();
  });

  it('reserves the area beyond corners for rotation without stealing scale handles', () => {
    const frame = buildVectorSelectionFrame(
      { x: 10, y: 20, width: 40, height: 30 },
      { resourceKey: 'selection:rotate' }
    );
    expect(hitTestVectorSelectionFrameRotation(frame, { x: 2, y: 12 }, 6)).toBe(true);
    expect(hitTestVectorSelectionFrameRotation(frame, { x: 8, y: 18 }, 6)).toBe(false);
    expect(hitTestVectorSelectionFrameRotation(frame, { x: 30, y: 35 }, 6)).toBe(false);
  });
});
