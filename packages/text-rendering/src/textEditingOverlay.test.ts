import type { RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { buildTextEditingOverlay } from './textEditingOverlay';

const layout: RealizedTextLayout = {
  schemaVersion: 2,
  key: 'layout:7',
  glyphRuns: [],
  lines: [{
    start: 0, end: 2, baseline: 12, ascent: 10, descent: 3,
    bounds: { x: 0, y: 2, width: 20, height: 13 }
  }],
  caretStops: [
    { textOffset: 0, x: 0, y: 2, height: 10, affinity: 'downstream' },
    { textOffset: 1, x: 9, y: 2, height: 10, affinity: 'upstream' },
    { textOffset: 2, x: 20, y: 2, height: 10, affinity: 'upstream' }
  ],
  selectionGeometry: [
    { start: 0, end: 1, bounds: { x: 0, y: 2, width: 9, height: 13 } },
    { start: 1, end: 2, bounds: { x: 9, y: 2, width: 11, height: 13 } }
  ],
  clusterMap: [],
  inkBounds: { x: 0, y: 2, width: 20, height: 13 },
  logicalBounds: { x: 0, y: 2, width: 20, height: 13 },
  warnings: []
};

describe('text editing overlay', () => {
  it('projects selection, caret, insertion and baseline into document space', () => {
    const overlay = buildTextEditingOverlay({
      layerId: 'text', layout, anchor: 0, focus: 1,
      localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 40 }
    });
    expect(overlay.quads).toHaveLength(1);
    expect(overlay.quads[0]!.points).toEqual([
      { x: 30, y: 44 }, { x: 48, y: 44 }, { x: 48, y: 70 }, { x: 30, y: 70 }
    ]);
    expect(overlay.lines.map(({ role }) => role)).toEqual(['caret', 'insertion', 'baseline']);
    expect(overlay.lines[0]).toMatchObject({
      start: { x: 48, y: 44 }, end: { x: 48, y: 64 }
    });
  });

  it('adds composition underlines without putting blink in the resource key', () => {
    const options = {
      layerId: 'text', layout, anchor: 2, focus: 2,
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      composition: { start: 0, end: 2 }
    } as const;
    const overlay = buildTextEditingOverlay(options);
    expect(overlay.lines.filter(({ role }) => role === 'composition')).toHaveLength(2);
    expect(overlay.resourceKey).toBe('text:layout:7:2:2:downstream:0-2:1:-:1,0,0,1,0,0');
  });

  it('honors affinity when one bidi boundary has multiple physical stops', () => {
    const bidi = { ...layout, caretStops: [
      ...layout.caretStops,
      { textOffset: 1, x: 17, y: 2, height: 10, affinity: 'downstream' as const }
    ] };
    const overlay = buildTextEditingOverlay({
      layerId: 'text', layout: bidi, anchor: 1, focus: 1,
      caretAffinity: 'downstream',
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    });
    expect(overlay.lines[0]?.start.x).toBe(17);
  });

  it('keeps an empty flow layer editable with synthesized GPU indicators', () => {
    const empty = {
      ...layout,
      key: 'empty',
      lines: [],
      caretStops: [],
      selectionGeometry: [],
      logicalBounds: { x: 4, y: 6, width: 0, height: 0 }
    };
    const overlay = buildTextEditingOverlay({
      layerId: 'empty', layout: empty, anchor: 0, focus: 0,
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 }
    });
    expect(overlay.lines.map(({ role }) => role)).toEqual(['caret', 'insertion', 'baseline']);
    expect(overlay.lines[0]).toMatchObject({
      start: { x: 14, y: 26 }, end: { x: 14, y: 42 }
    });
  });

  it('adds a transformed paragraph frame and transform-sensitive cache key', () => {
    const first = buildTextEditingOverlay({
      layerId: 'paragraph', layout, anchor: 0, focus: 0,
      frame: { x: 4, y: 6, width: 120, height: 48 },
      localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 }
    });
    const moved = buildTextEditingOverlay({
      layerId: 'paragraph', layout, anchor: 0, focus: 0,
      frame: { x: 4, y: 6, width: 120, height: 48 },
      localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 20 }
    });

    expect(first.lines.filter(({ role }) => role === 'frame')).toEqual([
      expect.objectContaining({ start: { x: 18, y: 32 }, end: { x: 258, y: 32 } }),
      expect.objectContaining({ start: { x: 258, y: 32 }, end: { x: 258, y: 128 } }),
      expect.objectContaining({ start: { x: 258, y: 128 }, end: { x: 18, y: 128 } }),
      expect.objectContaining({ start: { x: 18, y: 128 }, end: { x: 18, y: 32 } })
    ]);
    expect(first.markers).toHaveLength(8);
    expect(first.markers[0]).toEqual({
      role: 'frame-handle', point: { x: 18, y: 32 }, sizePx: 10
    });
    expect(moved.resourceKey).not.toBe(first.resourceKey);
  });
});
