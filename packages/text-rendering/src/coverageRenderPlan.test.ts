import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_INSTANCE,
  TEXT_LAYOUT_SCHEMA_VERSION,
  type RealizedTextLayout
} from '@lighttable/text-core';
import { UnsupportedCoverageTextError, planCoverageText } from './coverageRenderPlan';

const layout = (): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key: 'layout',
  glyphRuns: [{
    font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 16,
    fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
    paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0.5, b: 0, a: 0.5 } } },
    renderingMode: 'fill', direction: 'ltr',
    glyphIds: new Uint32Array([7, 8]), clusters: new Uint32Array([0, 1]),
    geometry: new Float32Array([2, 3, 10, 0, 12, 3, 9, 0])
  }],
  lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
  inkBounds: { x: 2, y: 0, width: 19, height: 16 },
  logicalBounds: { x: 2, y: 0, width: 19, height: 16 }, warnings: []
});

describe('coverage text render planning', () => {
  it('selects scale from the layer transform and preserves painter order', () => {
    const result = planCoverageText(layout(), [0, -2, 20, 2, 0, 30, 0, 0, 1], 4);
    expect(result.glyphs.map(({ raster }) => raster.glyphId)).toEqual([7, 8]);
    expect(result.glyphs[0]).toMatchObject({ x: 14, y: 34, transform: [0, 1, -1, 0] });
    expect(result.glyphs[0].raster).toMatchObject({ ppem: 32, fontSnapshotRevision: 4 });
    expect(result.glyphs[0].color[0]).toBeCloseTo(0.5);
    expect(result.glyphs[0].color[1]).toBeCloseTo(0.107, 3);
    expect(Object.isFrozen(result.glyphs[0])).toBe(true);
    expect(Object.isFrozen(result.glyphs[0].raster.key)).toBe(true);
  });

  it('keeps viewport zoom out of atlas identity', () => {
    const first = planCoverageText(layout(), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1);
    const second = planCoverageText(layout(), [1, 0, 100, 0, 1, 200, 0, 0, 1], 1);
    expect(first.glyphs[0].raster.key).toEqual(second.glyphs[0].raster.key);
  });

  it('converts logical cluster tables to stable visual paint order', () => {
    const candidate = layout();
    const run = candidate.glyphRuns[0];
    const logicalRtl: RealizedTextLayout = {
      ...candidate,
      glyphRuns: [{
        ...run, direction: 'rtl', glyphIds: new Uint32Array([7, 8, 9]),
        clusters: new Uint32Array([2, 1, 1]),
        geometry: new Float32Array([20, 3, 8, 0, 2, 3, 5, 0, 3, 3, 5, 0])
      }]
    };
    expect(planCoverageText(logicalRtl, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1)
      .glyphs.map(({ raster }) => raster.glyphId)).toEqual([8, 9, 7]);
  });

  it('fails explicitly instead of silently flattening unsupported paint', () => {
    const candidate = layout();
    const run = candidate.glyphRuns[0];
    const unsupported: RealizedTextLayout = {
      ...candidate,
      glyphRuns: [{ ...run, renderingMode: 'stroke', paint: { stroke: {
        paint: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } },
        width: 1, cap: 'butt', join: 'miter', miterLimit: 4
      } } }]
    };
    expect(() => planCoverageText(unsupported, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1))
      .toThrow(UnsupportedCoverageTextError);
  });
});
