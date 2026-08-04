import { describe, expect, it } from 'vitest';
import type { RealizedTextLayout } from '@lighttable/text-core';
import { horizontalLayoutForVertical, projectHorizontalLayoutToVertical } from './verticalTextLayout';

const horizontal: RealizedTextLayout = {
  schemaVersion: 2,
  key: 'vertical-fixture',
  glyphRuns: [{
    font: { font: {
      assetId: 'font', fingerprintSha256: 'abc', faceIndex: 0,
      source: 'bundled', container: 'sfnt', outline: 'truetype',
      embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
    }, variableAxes: {}, syntheticBold: false, syntheticItalic: false },
    fontSize: 20,
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Inter'] } },
    paint: {}, renderingMode: 'invisible', direction: 'ltr',
    glyphIds: new Uint32Array([1, 2]), clusters: new Uint32Array([0, 1]),
    geometry: new Float32Array([10, 20, 8, 0, 18, 20, 7, 0])
  }],
  lines: [{ start: 0, end: 2, baseline: 20, ascent: 15, descent: 5, bounds: { x: 10, y: 5, width: 15, height: 20 } }],
  caretStops: [{ textOffset: 0, affinity: 'downstream', x: 10, y: 5, height: 20 }],
  selectionGeometry: [{ start: 0, end: 1, bounds: { x: 10, y: 5, width: 8, height: 20 } }],
  clusterMap: [{ textStart: 0, textEnd: 1, glyphStart: 0, glyphEnd: 1 }],
  inkBounds: { x: 10, y: 5, width: 15, height: 20 },
  logicalBounds: { x: 10, y: 5, width: 15, height: 20 },
  warnings: []
};

describe('vertical text layout projection', () => {
  it('turns horizontal advances into top-to-bottom GPU-vector glyphs', () => {
    const projected = projectHorizontalLayoutToVertical(horizontal, {
      mode: 'point', origin: { x: 10, y: 20 }, writingMode: 'vertical-rl'
    } as const);
    expect([...projected.glyphRuns[0]!.geometry]).toEqual([10, 20, 0, 8, 10, 28, 0, 7]);
    expect(projected.glyphRuns[0]?.direction).toBe('ttb');
    expect([...projected.glyphRuns[0]!.transforms!]).toHaveLength(18);
    expect(projected.logicalBounds).toEqual({ x: 5, y: 20, width: 20, height: 15 });
  });

  it('swaps a paragraph frame for shaping and restores the authored frame', () => {
    const vertical = {
      mode: 'paragraph' as const,
      frame: { x: 100, y: 50, width: 80, height: 200 },
      overflow: 'indicator' as const,
      writingMode: 'vertical-rl' as const
    };
    expect(horizontalLayoutForVertical(vertical)).toMatchObject({
      frame: { x: 100, y: 50, width: 200, height: 80 },
      writingMode: 'horizontal-tb'
    });
    expect(projectHorizontalLayoutToVertical(horizontal, vertical).paragraphFrame?.bounds)
      .toEqual(vertical.frame);
  });
});
