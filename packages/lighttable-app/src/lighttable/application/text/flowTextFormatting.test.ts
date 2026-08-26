import { createDefaultFlowTextSource } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import {
  formatFlowTextSource,
  projectFlowTextFormat,
  projectFlowTextStyleProperty
} from './flowTextFormatting';

describe('flow text character formatting', () => {
  it('removes optional properties instead of retaining undefined contract values', () => {
    const source = createDefaultFlowTextSource('Text');
    const withStroke = formatFlowTextSource(source, null, { stroke: {
      paint: source.styleRuns[0]!.fill!, width: 4, cap: 'butt', join: 'miter', miterLimit: 4
    } });
    const withoutStroke = formatFlowTextSource(withStroke, null, { stroke: undefined });
    expect(withoutStroke.styleRuns[0]).not.toHaveProperty('stroke');
  });
  it('splits only the selected UTF-16 range and rejoins equivalent neighbors', () => {
    const source = createDefaultFlowTextSource('abcdef');
    const formatted = formatFlowTextSource(
      source, { anchor: 2, focus: 4 }, { tracking: 12 }
    );
    expect(formatted.styleRuns.map(({ start, end, tracking }) => ({ start, end, tracking })))
      .toEqual([
        { start: 0, end: 2, tracking: 0 },
        { start: 2, end: 4, tracking: 12 },
        { start: 4, end: 6, tracking: 0 }
      ]);
    expect(formatFlowTextSource(
      formatted, { anchor: 2, focus: 4 }, { tracking: 0 }
    ).styleRuns).toHaveLength(1);
  });

  it('projects mixed values without borrowing the first selected run', () => {
    const source = createDefaultFlowTextSource('abcd');
    const mixed = {
      ...source,
      styleRuns: [
        { ...source.styleRuns[0], start: 0, end: 2 },
        { ...source.styleRuns[0], start: 2, end: 4, fontSize: 32 }
      ]
    };
    expect(projectFlowTextFormat(mixed, { anchor: 0, focus: 4 }).style.kind).toBe('mixed');
    expect(projectFlowTextFormat(mixed, { anchor: 0, focus: 2 }).style).toMatchObject({
      kind: 'value', value: { fontSize: 16 }
    });
  });

  it('treats feature and axis maps as values independent of insertion order', () => {
    const source = createDefaultFlowTextSource('ab');
    const first = {
      ...source.styleRuns[0], start: 0, end: 1,
      openTypeFeatures: { liga: true, kern: false },
      variableAxes: { wght: 400, wdth: 100 }
    };
    const second = {
      ...source.styleRuns[0], start: 1, end: 2,
      openTypeFeatures: { kern: false, liga: true },
      variableAxes: { wdth: 100, wght: 400 }
    };
    const projection = projectFlowTextFormat(
      { ...source, styleRuns: [first, second] }, { anchor: 0, focus: 2 }
    );
    expect(projection.style.kind).toBe('value');
  });

  it('stores collapsed-caret changes as insertion metadata without rewriting text runs', () => {
    const source = createDefaultFlowTextSource('abc');
    const formatted = formatFlowTextSource(source, { anchor: 1, focus: 1 }, {
      baselineShift: 5,
      syntheticItalic: true
    });
    expect(formatted.styleRuns).toBe(source.styleRuns);
    expect(formatted.insertionStyle).toMatchObject({ baselineShift: 5, syntheticItalic: true });
    expect(projectFlowTextFormat(formatted, { anchor: 1, focus: 1 }).target).toBe('insertion');
  });

  it('applies caret paragraph formatting only to the current paragraph', () => {
    const source = createDefaultFlowTextSource('first\nsecond');
    const formatted = formatFlowTextSource(
      source, { anchor: 2, focus: 2 }, {}, { alignment: 'center' }
    );
    expect(formatted.paragraphRuns.map(({ start, end, alignment }) => ({ start, end, alignment })))
      .toEqual([
        { start: 0, end: 6, alignment: 'center' },
        { start: 6, end: 12, alignment: 'start' }
      ]);
    expect(formatted.insertionParagraph?.alignment).toBe('center');
  });

  it('projects only the paragraph under a collapsed caret', () => {
    const source = createDefaultFlowTextSource('one\ntwo');
    const paragraphRuns = [
      { ...source.paragraphRuns[0], start: 0, end: 4, alignment: 'start' as const },
      { ...source.paragraphRuns[0], start: 4, end: 7, alignment: 'end' as const }
    ];
    expect(projectFlowTextFormat(
      { ...source, paragraphRuns }, { anchor: 5, focus: 5 }
    ).paragraph).toMatchObject({ kind: 'value', value: { alignment: 'end' } });
  });

  it('expands a selection to the complete paragraphs it touches', () => {
    const source = createDefaultFlowTextSource('one\ntwo\nthree');
    const formatted = formatFlowTextSource(
      source, { anchor: 2, focus: 6 }, {}, { spaceAfter: 8 }
    );
    expect(formatted.paragraphRuns.map(({ start, end, spaceAfter }) => ({ start, end, spaceAfter })))
      .toEqual([
        { start: 0, end: 8, spaceAfter: 8 },
        { start: 8, end: 13, spaceAfter: 0 }
      ]);
  });

  it('formats a complete layer when no edit selection is supplied', () => {
    const source = createDefaultFlowTextSource('abc');
    const formatted = formatFlowTextSource(source, null, { fontWeight: 700 }, {
      lineHeight: { kind: 'multiple', value: 1.4 }
    });
    expect(formatted.styleRuns[0].fontWeight).toBe(700);
    expect(formatted.paragraphRuns[0].lineHeight).toEqual({ kind: 'multiple', value: 1.4 });
    expect(projectFlowTextFormat(formatted, null).target).toBe('layer');
  });

  it('formats retained insertion state on an empty complete layer', () => {
    const populated = createDefaultFlowTextSource('x');
    const { start: _start, end: _end, ...insertionStyle } = populated.styleRuns[0];
    const empty = { ...createDefaultFlowTextSource(''), insertionStyle };
    const formatted = formatFlowTextSource(empty, null, { fontSize: 28 });
    expect(formatted.insertionStyle?.fontSize).toBe(28);
    expect(projectFlowTextStyleProperty(formatted, null, 'fontSize')).toEqual({
      kind: 'value', value: 28
    });
  });

  it('seeds a legacy empty flow when it receives its first layer property', () => {
    const empty = createDefaultFlowTextSource('');
    expect(projectFlowTextStyleProperty(empty, null, 'fontSize')).toEqual({
      kind: 'value', value: 16
    });
    expect(formatFlowTextSource(empty, null, { fontSize: 30 }).insertionStyle?.fontSize)
      .toBe(30);
  });

  it('snaps formatting ranges away from Unicode grapheme interiors', () => {
    const source = createDefaultFlowTextSource('A\u{1F600}B');
    const formatted = formatFlowTextSource(source, { anchor: 2, focus: 3 }, { tracking: 5 });
    expect(formatted.styleRuns.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 1 }, { start: 1, end: 3 }, { start: 3, end: 4 }
    ]);
  });
});
