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
import { buildPathTextEditingOverlay } from './pathTextEditingOverlay';
import { projectRigidGlyphRunsToPath } from './rigidPathGlyphProjection';

const glyphRun: RealizedGlyphRun = {
  font: CONTRACT_FIXTURE_FONT_INSTANCE,
  fontSize: 20,
  fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
  paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
  renderingMode: 'fill', direction: 'ltr',
  glyphIds: new Uint32Array([1, 2]), clusters: new Uint32Array([0, 1]),
  geometry: new Float32Array([0, 0, 10, 0, 10, 0, 10, 0])
};

const layout: RealizedTextLayout = {
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION, key: 'path-linear', glyphRuns: [glyphRun],
  lines: [{
    start: 0, end: 2, baseline: 0, ascent: 8, descent: 2,
    bounds: { x: 0, y: -8, width: 20, height: 10 }
  }],
  caretStops: [
    { textOffset: 0, x: 0, y: -8, height: 10, affinity: 'downstream' },
    { textOffset: 1, x: 10, y: -8, height: 10, affinity: 'downstream' },
    { textOffset: 2, x: 20, y: -8, height: 10, affinity: 'upstream' }
  ],
  selectionGeometry: [
    { start: 0, end: 1, bounds: { x: 0, y: -8, width: 10, height: 10 } },
    { start: 1, end: 2, bounds: { x: 10, y: -8, width: 10, height: 10 } }
  ],
  clusterMap: [], warnings: [],
  inkBounds: { x: 0, y: -8, width: 20, height: 10 },
  logicalBounds: { x: 0, y: -8, width: 20, height: 10 }
};

const pathLayout: PathTextLayout = {
  mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
  startOffset: 10, endOffset: 90, side: 'left', upright: false
};

const metric = (vertical = false) => {
  const path = createVectorPath('path', 'Line', [createSubpath('line', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', vertical ? { x: 0, y: 100 } : { x: 100, y: 0 })
  ])]);
  return realizePathArcLength(path, 'line', identityAffineMatrix(), 0.25);
};

const build = (vertical = false) => {
  const table = metric(vertical);
  const projection = projectRigidGlyphRunsToPath(layout, pathLayout, table, 'start');
  return buildPathTextEditingOverlay({
    layerId: 'text', layout, pathLayout, table, projection,
    localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 7 },
    anchor: 0, focus: 1, composition: { start: 0, end: 1 }
  });
};

describe('path text editing overlay', () => {
  it('uses existing GPU quads, lines and fixed-size markers for path editing', () => {
    const overlay = build();
    expect(overlay.quads).toHaveLength(1);
    expect(overlay.quads[0]!.points).toEqual([
      { x: 25, y: -9 }, { x: 45, y: -9 },
      { x: 45, y: 11 }, { x: 25, y: 11 }
    ]);
    expect(overlay.staticLines?.map(({ role }) => role)).toEqual([
      'path-baseline', 'path-direction'
    ]);
    expect(overlay.lines.map(({ role }) => role)).toEqual([
      'caret', 'insertion', 'composition'
    ]);
    expect(overlay.markers).toEqual([
      { role: 'path-start-handle', point: { x: 25, y: 7 }, sizePx: 10 },
      { role: 'path-end-handle', point: { x: 185, y: 7 }, sizePx: 10 },
      { role: 'path-direction-handle', point: { x: 49, y: 7 }, sizePx: 8 }
    ]);
  });

  it('rotates caret and selection geometry along a vertical path', () => {
    const overlay = build(true);
    expect(overlay.quads[0]!.points).toEqual([
      { x: 21, y: 27 }, { x: 21, y: 47 },
      { x: 1, y: 47 }, { x: 1, y: 27 }
    ]);
    expect(overlay.lines.find(({ role }) => role === 'caret')).toMatchObject({
      start: { x: 21, y: 47 }, end: { x: 1, y: 47 }
    });
  });

  it('keys geometry by path realization and editing state, never caret blink', () => {
    const first = build();
    const second = build();
    expect(second.resourceKey).toBe(first.resourceKey);
    expect(first.resourceKey).toContain(':path-linear:');
  });

  it('indexes caret stops once per immutable layout for logarithmic navigation', () => {
    let traversals = 0;
    const indexedLayout: RealizedTextLayout = {
      ...layout,
      caretStops: new Proxy(layout.caretStops, {
        get(target, property, receiver) {
          if (property === 'forEach') {
            return (...args: Parameters<typeof target.forEach>) => {
              traversals += 1;
              return target.forEach(...args);
            };
          }
          return Reflect.get(target, property, receiver);
        }
      })
    };
    const table = metric();
    const projection = projectRigidGlyphRunsToPath(indexedLayout, pathLayout, table, 'start');
    const options = {
      layerId: 'indexed', layout: indexedLayout, pathLayout, table, projection,
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, anchor: 0
    } as const;
    buildPathTextEditingOverlay({ ...options, focus: 1 });
    buildPathTextEditingOverlay({ ...options, focus: 2 });
    expect(traversals).toBe(1);
  });
});
