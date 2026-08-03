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

  it.each(['clip', 'indicator'] as const)('attaches a transformed GPU clip for a %s paragraph frame', (overflow) => {
    const candidate = layout();
    const clipped: RealizedTextLayout = {
      ...candidate,
      paragraphFrame: {
        bounds: { x: 0, y: 0, width: 20, height: 10 },
        overflow, overflowed: true, firstOverflowTextOffset: 1
      }
    };
    const planned = planCoverageText(clipped, [2, 0, 10, 0, 3, 20, 0, 0, 1], 1);
    expect(planned.glyphs.map(({ raster }) => raster.glyphId)).toEqual([7, 8]);
    expect(planned.glyphs[0]?.clip).toEqual([10, 20, 50, 20, 50, 50, 10, 50]);
  });

  it('keeps overflowing glyphs for a visible paragraph frame', () => {
    const candidate = layout();
    const visible: RealizedTextLayout = {
      ...candidate,
      paragraphFrame: {
        bounds: { x: 0, y: 0, width: 20, height: 10 },
        overflow: 'visible', overflowed: true, firstOverflowTextOffset: 1
      }
    };
    expect(planCoverageText(visible, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1).glyphs)
      .toHaveLength(2);
    expect(planCoverageText(visible, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1).glyphs[0]?.clip)
      .toBeUndefined();
  });

  it('does not rasterize complete lines after the first clipped line', () => {
    const candidate = layout();
    const run = candidate.glyphRuns[0];
    const clipped: RealizedTextLayout = {
      ...candidate,
      glyphRuns: [{
        ...run,
        glyphIds: new Uint32Array([7, 8, 9]),
        clusters: new Uint32Array([0, 1, 2]),
        geometry: new Float32Array([2, 3, 10, 0, 12, 13, 9, 0, 12, 23, 9, 0])
      }],
      lines: [
        { start: 0, end: 1, baseline: 4, ascent: 4, descent: 1,
          bounds: { x: 0, y: 0, width: 10, height: 5 } },
        { start: 1, end: 2, baseline: 14, ascent: 4, descent: 1,
          bounds: { x: 0, y: 10, width: 10, height: 5 } },
        { start: 2, end: 3, baseline: 24, ascent: 4, descent: 1,
          bounds: { x: 0, y: 20, width: 10, height: 5 } }
      ],
      paragraphFrame: {
        bounds: { x: 0, y: 0, width: 20, height: 12 },
        overflow: 'clip', overflowed: true, firstOverflowTextOffset: 1
      }
    };
    expect(planCoverageText(clipped, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1)
      .glyphs.map(({ raster }) => raster.glyphId)).toEqual([7, 8]);
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
