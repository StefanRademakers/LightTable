import { describe, expect, it } from 'vitest';
import {
  hitTestParagraphFrameHandle,
  paragraphFrameHandles,
  resizeParagraphFrame
} from './paragraphFrameResize';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const frame = { x: 10, y: 20, width: 100, height: 60 };

describe('paragraph frame resize geometry', () => {
  it('projects the same eight handles used by the GPU frame overlay', () => {
    expect(paragraphFrameHandles(frame, {
      a: 0, b: 2, c: -2, d: 0, tx: 200, ty: 50
    })).toEqual([
      { kind: 'north-west', point: { x: 160, y: 70 } },
      { kind: 'north', point: { x: 160, y: 170 } },
      { kind: 'north-east', point: { x: 160, y: 270 } },
      { kind: 'east', point: { x: 100, y: 270 } },
      { kind: 'south-east', point: { x: 40, y: 270 } },
      { kind: 'south', point: { x: 40, y: 170 } },
      { kind: 'south-west', point: { x: 40, y: 70 } },
      { kind: 'west', point: { x: 100, y: 70 } }
    ]);
  });

  it('hit-tests the closest transformed handle with a document-space radius', () => {
    expect(hitTestParagraphFrameHandle(
      frame, { ...identity, tx: 30, ty: 40 }, { x: 141, y: 61 }, 3
    )?.kind).toBe('north-east');
    expect(hitTestParagraphFrameHandle(frame, identity, { x: 60, y: 50 }, 3)).toBeNull();
  });

  it('resizes corners and edges in local space without moving opposite edges', () => {
    expect(resizeParagraphFrame(frame, 'south-east', { x: 150, y: 120 }, identity)).toEqual({
      x: 10, y: 20, width: 140, height: 100
    });
    expect(resizeParagraphFrame(frame, 'west', { x: 30, y: 999 }, identity)).toEqual({
      x: 30, y: 20, width: 80, height: 60
    });
  });

  it('inverts the layer transform and clamps drags crossing the opposite edge', () => {
    expect(resizeParagraphFrame(
      frame,
      'north-west',
      { x: 398, y: 278 },
      { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 80 },
      6
    )).toEqual({ x: 104, y: 74, width: 6, height: 6 });
  });

  it('rejects singular transforms and invalid minimum sizes', () => {
    expect(resizeParagraphFrame(
      frame, 'east', { x: 20, y: 20 }, { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }
    )).toBeNull();
    expect(() => resizeParagraphFrame(frame, 'east', { x: 20, y: 20 }, identity, 0))
      .toThrow(RangeError);
  });
});
