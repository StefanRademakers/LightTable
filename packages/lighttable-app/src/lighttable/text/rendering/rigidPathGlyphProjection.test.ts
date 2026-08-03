import {
  CONTRACT_FIXTURE_FONT_INSTANCE,
  TEXT_LAYOUT_SCHEMA_VERSION,
  type PathTextLayout,
  type RealizedGlyphRun,
  type RealizedTextLayout
} from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { realizePathArcLength } from '@lighttable/vector-rendering';
import { describe, expect, it } from 'vitest';
import { projectRigidGlyphRunsToPath } from './rigidPathGlyphProjection';

const run = (positions: readonly number[]): RealizedGlyphRun => ({
  font: CONTRACT_FIXTURE_FONT_INSTANCE,
  fontSize: 20,
  fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
  paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
  renderingMode: 'fill',
  direction: 'ltr',
  glyphIds: new Uint32Array(positions.map((_, index) => index + 1)),
  clusters: new Uint32Array(positions.map((_, index) => index)),
  geometry: new Float32Array(positions.flatMap((x) => [x, 0, 10, 0]))
});

const layout = (...runs: RealizedGlyphRun[]): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key: 'linear',
  glyphRuns: runs,
  lines: [], caretStops: [], selectionGeometry: [], clusterMap: [], warnings: [],
  inkBounds: { x: 0, y: -10, width: 20, height: 10 },
  logicalBounds: { x: 0, y: -10, width: 20, height: 10 }
});

const pathLayout = (change: Partial<PathTextLayout> = {}): PathTextLayout => ({
  mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
  startOffset: 0, side: 'left', upright: false, ...change
});

const table = (vertical = false) => {
  const path = createVectorPath('path', 'Line', [createSubpath('line', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', vertical ? { x: 0, y: 100 } : { x: 100, y: 0 })
  ])]);
  return realizePathArcLength(path, 'line', identityAffineMatrix(), 0.25);
};

const matrix = (projection: ReturnType<typeof projectRigidGlyphRunsToPath>, glyphIndex: number) =>
  [...projection.glyphRuns[0]!.transforms!.slice(glyphIndex * 9, glyphIndex * 9 + 9)];

describe('rigid path glyph projection', () => {
  it('places shaped origins on a horizontal path without deforming glyphs', () => {
    const projection = projectRigidGlyphRunsToPath(layout(run([0, 10])), pathLayout(), table(), 'start');
    expect(projection.contentAdvance).toBe(20);
    expect(matrix(projection, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(matrix(projection, 1)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('uses the shared text alignment within authored start/end handles', () => {
    const projection = projectRigidGlyphRunsToPath(
      layout(run([0, 10])), pathLayout({ startOffset: 10, endOffset: 90 }), table(), 'center'
    );
    expect(projection.range).toMatchObject({ start: 10, end: 90, origin: 40, available: 80 });
    expect(matrix(projection, 0)[2]).toBe(40);
  });

  it('rotates rigid glyphs with vertical and reverse path traversal', () => {
    const projection = projectRigidGlyphRunsToPath(
      layout(run([0])), pathLayout({ startOffset: 10, direction: 'reverse' }), table(true), 'start'
    );
    const transform = matrix(projection, 0);
    expect(transform[0]).toBeCloseTo(0);
    expect(transform[1]).toBeCloseTo(1);
    expect(transform[3]).toBeCloseTo(-1);
    expect(transform[4]).toBeCloseTo(0);
    expect(transform[2]).toBeCloseTo(0);
    expect(transform[5]).toBeCloseTo(90);
  });

  it('keeps right-side glyphs upright when requested', () => {
    const upsideDown = projectRigidGlyphRunsToPath(
      layout(run([0])), pathLayout({ side: 'right' }), table(), 'start'
    );
    expect(matrix(upsideDown, 0)[0]).toBeCloseTo(-1);
    const upright = projectRigidGlyphRunsToPath(
      layout(run([0])), pathLayout({ side: 'right', upright: true }), table(), 'start'
    );
    expect(matrix(upright, 0)[0]).toBeCloseTo(1);
  });
});
