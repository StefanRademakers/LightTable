import { describe, expect, it } from 'vitest';
import type { TextWorkerGlyphOutlineResult } from '@lighttable/text-core';
import { createGlyphPlacementTransform, glyphOutlineToVectorPath } from './glyphOutlineToVectorPath';

const outline = (
  verbs: number[],
  coordinates: number[],
  unitsPerEm = 1000
): TextWorkerGlyphOutlineResult => ({
  unitsPerEm,
  verbs: new Uint8Array(verbs),
  coordinates: new Float32Array(coordinates),
  bounds: new Float32Array([0, 0, 1000, 1000])
});

describe('glyphOutlineToVectorPath', () => {
  it('converts closed line contours and preserves multiple holes', () => {
    const path = glyphOutlineToVectorPath(outline(
      [0, 1, 1, 4, 0, 1, 1, 4],
      [0, 0, 10, 0, 10, 10, 2, 2, 8, 2, 8, 8]
    ), { id: 'glyph:42' });

    expect(path.fillRule).toBe('nonzero');
    expect(path.subpaths).toHaveLength(2);
    expect(path.subpaths.map(({ closed }) => closed)).toEqual([true, true]);
    expect(path.subpaths[1]?.anchors.map(({ position }) => position)).toEqual([
      { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }
    ]);
  });

  it('converts quadratic segments exactly into canonical cubic handles', () => {
    const path = glyphOutlineToVectorPath(outline([0, 2], [0, 0, 3, 6, 9, 0]), { id: 'quad' });
    const [start, end] = path.subpaths[0]!.anchors;

    expect(start?.handleOut).toEqual({ x: 2, y: 4 });
    expect(end?.handleIn).toEqual({ x: 5, y: 4 });
    expect(end?.position).toEqual({ x: 9, y: 0 });
  });

  it('preserves cubic handles and merges an explicit closing endpoint', () => {
    const path = glyphOutlineToVectorPath(outline(
      [0, 3, 3, 4],
      [0, 0, 2, 0, 4, 2, 6, 2, 4, 4, 2, 4, 0, 0]
    ), { id: 'cubic' });
    const anchors = path.subpaths[0]!.anchors;

    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.handleOut).toEqual({ x: 2, y: 0 });
    expect(anchors[0]?.handleIn).toEqual({ x: 2, y: 4 });
    expect(anchors[1]?.handleIn).toEqual({ x: 4, y: 2 });
    expect(anchors[1]?.handleOut).toEqual({ x: 4, y: 4 });
  });

  it('places y-up font geometry in document coordinates without viewport input', () => {
    expect(createGlyphPlacementTransform(2048, {
      fontSize: 64,
      origin: { x: 12, y: 30 }
    })).toEqual({ a: 0.03125, b: 0, c: 0, d: -0.03125, tx: 12, ty: 30 });

    const path = glyphOutlineToVectorPath(outline([0], [0, 0], 2048), {
      id: 'placed',
      placement: { fontSize: 64, origin: { x: 12, y: 30 } }
    });
    expect(path.transform).toEqual({ a: 0.03125, b: 0, c: 0, d: -0.03125, tx: 12, ty: 30 });
    expect(path.transformRevision).toBe(1);
  });

  it('rejects malformed streams before they reach vector rendering', () => {
    expect(() => glyphOutlineToVectorPath(outline([1], [1, 2]), { id: 'no-move' }))
      .toThrow('must follow a move');
    expect(() => glyphOutlineToVectorPath(outline([0], [1]), { id: 'short' }))
      .toThrow('ended before');
    expect(() => glyphOutlineToVectorPath(outline([0], [1, 2, 3, 4]), { id: 'trailing' }))
      .toThrow('unused coordinates');
    expect(() => glyphOutlineToVectorPath(outline([9], []), { id: 'unknown' }))
      .toThrow('Unknown glyph outline verb');
  });
});
