import { createDefaultFlowTextSource } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import {
  deleteFlowTextSelection,
  graphemeStops,
  moveTextOffset,
  moveTextSelection,
  moveTextSelectionInLayout,
  moveTextSelectionHorizontallyInLayout,
  replaceFlowTextSelection,
  snapTextOffset
} from './flowTextEditing';

describe('flow text editing', () => {
  it('uses UTF-16 offsets but never stops inside a grapheme', () => {
    const text = 'A👨‍👩‍👧‍👦e\u0301B';
    expect(graphemeStops(text)).toEqual([0, 1, 12, 14, 15]);
    expect(snapTextOffset(text, 6)).toBe(1);
    expect(moveTextOffset(text, 12, 'backward')).toBe(1);
    expect(moveTextOffset(text, 12, 'forward')).toBe(14);
  });

  it('collapses or extends selections with predictable arrow semantics', () => {
    const text = 'One two';
    expect(moveTextSelection(text, { anchor: 1, focus: 5 }, 'backward'))
      .toEqual({ anchor: 1, focus: 1 });
    expect(moveTextSelection(text, { anchor: 1, focus: 5 }, 'forward'))
      .toEqual({ anchor: 5, focus: 5 });
    expect(moveTextSelection(text, { anchor: 0, focus: 0 }, 'forward', { extend: true }))
      .toEqual({ anchor: 0, focus: 1 });
    expect(moveTextOffset(text, 7, 'backward', 'word')).toBe(4);
    expect(moveTextOffset(text, 0, 'forward', 'word')).toBe(3);
  });

  it('replaces a range and keeps style and paragraph coverage canonical', () => {
    const source = createDefaultFlowTextSource('Hello');
    const result = replaceFlowTextSelection(source, { anchor: 1, focus: 4 }, 'i👋');
    expect(result.source.text).toBe('Hi👋o');
    expect(result.selection).toEqual({ anchor: 4, focus: 4 });
    expect(result.source.styleRuns).toHaveLength(1);
    expect(result.source.styleRuns[0]).toMatchObject({ start: 0, end: 5 });
    expect(result.source.paragraphRuns[0]).toMatchObject({ start: 0, end: 5 });
  });

  it('preserves mixed runs on both sides of a replacement', () => {
    const base = createDefaultFlowTextSource('abcd');
    const first = base.styleRuns[0]!;
    const source = {
      ...base,
      styleRuns: [
        { ...first, start: 0, end: 2 },
        { ...first, start: 2, end: 4, fontWeight: 700 }
      ]
    };
    const result = replaceFlowTextSelection(source, { anchor: 1, focus: 3 }, 'XY');
    expect(result.source.styleRuns.map(({ start, end, fontWeight }) => (
      { start, end, fontWeight }
    ))).toEqual([
      { start: 0, end: 3, fontWeight: 400 },
      { start: 3, end: 4, fontWeight: 700 }
    ]);
  });

  it('deletes complete emoji and combining graphemes', () => {
    const family = '👨‍👩‍👧‍👦';
    const source = createDefaultFlowTextSource(`A${family}e\u0301B`);
    const afterCombining = deleteFlowTextSelection(
      source,
      { anchor: source.text.length - 1, focus: source.text.length - 1 },
      'backward'
    );
    expect(afterCombining.source.text).toBe(`A${family}B`);
    const afterEmoji = deleteFlowTextSelection(
      afterCombining.source,
      { anchor: 1 + family.length, focus: 1 + family.length },
      'backward'
    );
    expect(afterEmoji.source.text).toBe('AB');
  });

  it('removes the selected range before applying directional deletion', () => {
    const source = createDefaultFlowTextSource('alpha beta');
    expect(deleteFlowTextSelection(source, { anchor: 0, focus: 5 }, 'backward').source.text)
      .toBe(' beta');
    expect(deleteFlowTextSelection(source, { anchor: 10, focus: 10 }, 'backward', 'word').source.text)
      .toBe('alpha ');
  });

  it('uses realized lines for Home, End and vertical movement', () => {
    const layout = {
      schemaVersion: 2 as const, key: 'lines', glyphRuns: [], selectionGeometry: [], clusterMap: [], warnings: [],
      inkBounds: { x: 0, y: 0, width: 20, height: 20 },
      logicalBounds: { x: 0, y: 0, width: 20, height: 20 },
      lines: [
        { start: 0, end: 2, baseline: 8, ascent: 8, descent: 2, bounds: { x: 0, y: 0, width: 20, height: 10 } },
        { start: 3, end: 5, baseline: 18, ascent: 8, descent: 2, bounds: { x: 0, y: 10, width: 20, height: 10 } }
      ],
      caretStops: [
        { textOffset: 0, x: 0, y: 8, height: 8, affinity: 'downstream' as const },
        { textOffset: 1, x: 9, y: 8, height: 8, affinity: 'upstream' as const },
        { textOffset: 2, x: 20, y: 8, height: 8, affinity: 'upstream' as const },
        { textOffset: 3, x: 0, y: 18, height: 8, affinity: 'downstream' as const },
        { textOffset: 4, x: 10, y: 18, height: 8, affinity: 'upstream' as const },
        { textOffset: 5, x: 20, y: 18, height: 8, affinity: 'upstream' as const }
      ]
    };
    expect(moveTextSelectionInLayout(layout, { anchor: 1, focus: 1 }, 'line-end').selection)
      .toEqual({ anchor: 2, focus: 2 });
    expect(moveTextSelectionInLayout(layout, { anchor: 1, focus: 1 }, 'line-down').selection)
      .toEqual({ anchor: 4, focus: 4 });
    expect(moveTextSelectionInLayout(layout, { anchor: 4, focus: 4 }, 'line-up', true).selection)
      .toEqual({ anchor: 4, focus: 1 });
  });

  it('moves horizontally through mixed-direction visual caret order', () => {
    const layout = {
      schemaVersion: 2 as const, key: 'bidi', glyphRuns: [], selectionGeometry: [], clusterMap: [], warnings: [],
      inkBounds: { x: 0, y: 0, width: 80, height: 10 },
      logicalBounds: { x: 0, y: 0, width: 80, height: 10 },
      lines: [{ start: 0, end: 7, baseline: 8, ascent: 8, descent: 2, bounds: { x: 0, y: 0, width: 80, height: 10 } }],
      caretStops: [
        { textOffset: 0, x: 0, y: 8, height: 8, affinity: 'downstream' as const },
        { textOffset: 1, x: 10, y: 8, height: 8, affinity: 'downstream' as const },
        { textOffset: 2, x: 20, y: 8, height: 8, affinity: 'downstream' as const },
        { textOffset: 3, x: 30, y: 8, height: 8, affinity: 'downstream' as const },
        { textOffset: 7, x: 40, y: 8, height: 8, affinity: 'upstream' as const },
        { textOffset: 6, x: 50, y: 8, height: 8, affinity: 'upstream' as const },
        { textOffset: 5, x: 60, y: 8, height: 8, affinity: 'upstream' as const },
        { textOffset: 4, x: 70, y: 8, height: 8, affinity: 'upstream' as const }
      ]
    };
    expect(moveTextSelectionHorizontallyInLayout(
      layout, { anchor: 7, focus: 7 }, 'forward', false, 'upstream'
    ).selection).toEqual({ anchor: 6, focus: 6 });
    expect(moveTextSelectionHorizontallyInLayout(
      layout, { anchor: 6, focus: 6 }, 'backward', false, 'upstream'
    ).selection).toEqual({ anchor: 7, focus: 7 });
    expect(moveTextSelectionHorizontallyInLayout(
      layout, { anchor: 6, focus: 6 }, 'forward', true, 'upstream'
    ).selection).toEqual({ anchor: 6, focus: 5 });
    expect(moveTextSelectionInLayout(
      layout, { anchor: 6, focus: 6 }, 'line-start', false, 'upstream'
    ).selection).toEqual({ anchor: 0, focus: 0 });
    expect(moveTextSelectionInLayout(
      layout, { anchor: 6, focus: 6 }, 'line-end', false, 'upstream'
    ).selection).toEqual({ anchor: 4, focus: 4 });
  });
});
