import type { PathTextLayout } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { realizePathArcLength } from '@lighttable/vector-rendering';
import { describe, expect, it } from 'vitest';
import type { RigidPathGlyphProjection } from './rigidPathGlyphProjection';
import { hitTestPathTextHandle, pathTextHandlePresentation } from './pathTextHandles';

const table = realizePathArcLength(createVectorPath('path', 'Line', [createSubpath('line', [
  createAnchor('a', { x: 0, y: 0 }), createAnchor('b', { x: 100, y: 0 })
])]), 'line', identityAffineMatrix(), 0.25);
const layout: PathTextLayout = {
  mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
  startOffset: 10, endOffset: 90, direction: 'forward', side: 'left', upright: false
};
const projection: RigidPathGlyphProjection = {
  glyphRuns: [], linearOrigin: 0, contentAdvance: 20,
  range: { start: 10, end: 90, origin: 10, available: 80, overflow: 0, direction: 'forward' }
};

describe('path text handle presentation', () => {
  it('shares exact start, end and direction points with hit testing', () => {
    const handles = pathTextHandlePresentation(layout, table, projection);
    expect(handles).toEqual({
      start: { x: 10, y: 0 }, end: { x: 90, y: 0 }, direction: { x: 22, y: 0 }
    });
    const transform = { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 7 };
    expect(hitTestPathTextHandle(handles, transform, { x: 49, y: 7 }, 5)).toBe('direction');
    expect(hitTestPathTextHandle(handles, transform, { x: 185, y: 7 }, 5)).toBe('end');
    expect(hitTestPathTextHandle(handles, transform, { x: 100, y: 100 }, 5)).toBeNull();
  });
});
