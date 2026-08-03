import {
  CONTRACT_FIXTURE_FONT_ASSET,
  createDefaultFlowTextSource,
  type FlowTextSource
} from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { segmentFlowParagraphs } from './incrementalParagraphLayout';
import {
  assembleParagraphLayout,
  type PackedParagraphFragment
} from './paragraphFragmentLayout';

const fragment = (
  textLength: number,
  glyphId: number,
  terminalEmptyLine = false
): PackedParagraphFragment => ({
  runMeta: new Uint32Array([0, 0, 1, 0, 1]),
  glyphIds: new Uint32Array([glyphId]),
  clusters: new Uint32Array([0]),
  geometry: new Float32Array([0, 8, 5, 0]),
  lineMeta: new Uint32Array(terminalEmptyLine
    ? [0, textLength, textLength, textLength]
    : [0, textLength]),
  lineGeometry: new Float32Array(terminalEmptyLine
    ? [8, 8, 2, 0, 0, 5, 10, 18, 8, 2, 0, 10, 0, 10]
    : [8, 8, 2, 0, 0, 5, 10]),
  caretMeta: new Uint32Array([0, 1, textLength, 0]),
  caretGeometry: new Float32Array([0, 0, 10, 0, terminalEmptyLine ? 10 : 0, 10]),
  selectionMeta: new Uint32Array([0, textLength]),
  selectionGeometry: new Float32Array([0, 0, 5, 10]),
  clusterMap: new Uint32Array([0, textLength, 0, 1]),
  bounds: new Float32Array([0, 0, 5, 8, 0, 0, 5, terminalEmptyLine ? 20 : 10])
});

const paragraphSource = (): FlowTextSource & {
  readonly layout: Extract<FlowTextSource['layout'], { readonly mode: 'paragraph' }>;
} => {
  const base = createDefaultFlowTextSource('A\nB');
  return {
    ...base,
    styleRuns: [
      { ...base.styleRuns[0], end: 2 },
      { ...base.styleRuns[0], start: 2, fill: {
        kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 }
      } }
    ],
    paragraphRuns: [
      { ...base.paragraphRuns[0], end: 2, spaceAfter: 4 },
      { ...base.paragraphRuns[0], start: 2, spaceBefore: 3 }
    ],
    layout: {
      mode: 'paragraph',
      frame: { x: 20, y: 30, width: 240, height: 100 },
      overflow: 'indicator',
      writingMode: 'horizontal-tb'
    }
  };
};

describe('paragraph fragment assembly', () => {
  it('trims only the non-final standalone empty line and rebases every offset and geometry table', () => {
    const source = paragraphSource();
    const segments = segmentFlowParagraphs(source);
    const first = fragment(2, 11, true);
    const second = fragment(1, 22);
    const layout = assembleParagraphLayout({
      key: 'whole-layout',
      source,
      selectedFonts: [CONTRACT_FIXTURE_FONT_ASSET, CONTRACT_FIXTURE_FONT_ASSET],
      placements: [
        {
          segment: segments[0], fragment: first,
          paragraph: { alignment: 0, lineHeightKind: 0, lineHeightValue: 0,
            firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 4 }
        },
        {
          segment: segments[1], fragment: second,
          paragraph: { alignment: 0, lineHeightKind: 0, lineHeightValue: 0,
            firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 3, spaceAfter: 0 }
        }
      ],
      maxGlyphCount: 10
    });

    expect(layout.key).toBe('whole-layout');
    expect(layout.lines.map(({ start, end, baseline }) => ({ start, end, baseline }))).toEqual([
      { start: 0, end: 2, baseline: 38 },
      { start: 2, end: 3, baseline: 55 }
    ]);
    expect(layout.glyphRuns.map((run) => ({
      sourceRunIndex: run.fontResolution.kind === 'flow-exact' ? run.fontResolution.sourceRunIndex : -1,
      clusters: [...run.clusters],
      y: run.geometry[1]
    }))).toEqual([
      { sourceRunIndex: 0, clusters: [0], y: 38 },
      { sourceRunIndex: 1, clusters: [2], y: 55 }
    ]);
    expect(layout.clusterMap).toEqual([
      { textStart: 0, textEnd: 2, glyphStart: 0, glyphEnd: 1 },
      { textStart: 2, textEnd: 3, glyphStart: 1, glyphEnd: 2 }
    ]);
    expect(layout.caretStops.some(({ textOffset, y }) => textOffset === 2 && y === 40)).toBe(true);
    expect(layout.paragraphFrame).toMatchObject({ overflow: 'indicator', overflowed: false });

    layout.glyphRuns[0].glyphIds[0] = 99;
    expect(first.glyphIds[0]).toBe(11);
  });

  it('keeps the terminal empty line when the authored flow really ends in a separator', () => {
    const base = createDefaultFlowTextSource('A\n');
    const source = {
      ...base,
      layout: {
        mode: 'paragraph' as const,
        frame: { x: 0, y: 0, width: 100, height: 15 },
        overflow: 'indicator' as const,
        writingMode: 'horizontal-tb' as const
      }
    };
    const layout = assembleParagraphLayout({
      key: 'trailing-line',
      source,
      selectedFonts: [CONTRACT_FIXTURE_FONT_ASSET],
      placements: [{
        segment: segmentFlowParagraphs(source)[0],
        fragment: fragment(2, 11, true),
        paragraph: { alignment: 0, lineHeightKind: 0, lineHeightValue: 0,
          firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 0 }
      }],
      maxGlyphCount: 10
    });

    expect(layout.lines.map(({ start, end }) => [start, end])).toEqual([[0, 2], [2, 2]]);
    expect(layout.paragraphFrame).toMatchObject({ overflowed: true, firstOverflowTextOffset: 2 });
  });

  it('enforces the whole-flow glyph limit even when fragments are already cached', () => {
    const source = paragraphSource();
    const segments = segmentFlowParagraphs(source);
    expect(() => assembleParagraphLayout({
      key: 'limited',
      source,
      selectedFonts: [CONTRACT_FIXTURE_FONT_ASSET, CONTRACT_FIXTURE_FONT_ASSET],
      placements: segments.map((segment, index) => ({
        segment,
        fragment: fragment(segment.text.length, index + 1, index === 0),
        paragraph: { alignment: 0, lineHeightKind: 0, lineHeightValue: 0,
          firstLineIndent: 0, startIndent: 0, endIndent: 0, spaceBefore: 0, spaceAfter: 0 }
      })),
      maxGlyphCount: 1
    })).toThrow(/maxGlyphCount/);
  });
});
