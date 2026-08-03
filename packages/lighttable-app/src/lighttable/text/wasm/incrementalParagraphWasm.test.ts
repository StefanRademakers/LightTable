import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_ASSET,
  createDefaultFlowTextSource,
  type FlowTextSource
} from '@lighttable/text-core';
import initializeTextLayoutWasm, {
  drop_layout_session as dropLayoutSession,
  realize_flow_text as realizeFlowText,
  register_layout_font as registerLayoutFont
} from './generated/text_layout_wasm.js';
import { segmentFlowParagraphs } from './incrementalParagraphLayout';
import {
  assembleParagraphLayout,
  type PackedParagraphFragment,
  type ParagraphFragmentPlacement
} from './paragraphFragmentLayout';

const session = 'vitest-incremental-paragraph:1';
const family = 'Anton';
const asset = {
  ...CONTRACT_FIXTURE_FONT_ASSET,
  assetId: 'anton-incremental',
  fingerprintSha256: 'anton-incremental'
};
const fontStrings = new TextEncoder().encode(`${family}${asset.fingerprintSha256}`);
const fontRanges = new Uint32Array([0, family.length, family.length, fontStrings.length]);
const paragraph = {
  alignment: 0 as const,
  lineHeightKind: 2 as const,
  lineHeightValue: 1.25,
  firstLineIndent: 4,
  startIndent: 6,
  endIndent: 8,
  spaceBefore: 7,
  spaceAfter: 11
};

const capture = (raw: ReturnType<typeof realizeFlowText>): PackedParagraphFragment => ({
  runMeta: Uint32Array.from(raw.run_meta()),
  glyphIds: Uint32Array.from(raw.glyph_ids()),
  clusters: Uint32Array.from(raw.clusters()),
  geometry: Float32Array.from(raw.geometry()),
  lineMeta: Uint32Array.from(raw.line_meta()),
  lineGeometry: Float32Array.from(raw.line_geometry()),
  caretMeta: Uint32Array.from(raw.caret_meta()),
  caretGeometry: Float32Array.from(raw.caret_geometry()),
  selectionMeta: Uint32Array.from(raw.selection_meta()),
  selectionGeometry: Float32Array.from(raw.selection_geometry()),
  clusterMap: Uint32Array.from(raw.cluster_map()),
  bounds: Float32Array.from(raw.bounds())
});

const round = (values: Iterable<number>) => [...values].map((value) => Math.round(value * 1000));

const paragraphSource = (text: string): FlowTextSource & {
  readonly layout: Extract<FlowTextSource['layout'], { readonly mode: 'paragraph' }>;
} => {
  const base = createDefaultFlowTextSource(text);
  return {
    ...base,
    styleRuns: base.styleRuns.map((run) => ({
      ...run,
      requestedFont: { families: [family], preferredAsset: asset },
      fontSize: 24
    })),
    paragraphRuns: base.paragraphRuns.map((run) => ({
      ...run,
      lineHeight: { kind: 'multiple' as const, value: 1.25 },
      firstLineIndent: paragraph.firstLineIndent,
      startIndent: paragraph.startIndent,
      endIndent: paragraph.endIndent,
      spaceBefore: paragraph.spaceBefore,
      spaceAfter: paragraph.spaceAfter
    })),
    layout: {
      mode: 'paragraph',
      frame: { x: 10, y: 20, width: 140, height: 500 },
      overflow: 'indicator',
      writingMode: 'horizontal-tb'
    }
  };
};

beforeAll(async () => {
  const wasm = await readFile(resolve(import.meta.dirname, 'generated/text_layout_wasm_bg.wasm'));
  await initializeTextLayoutWasm({ module_or_path: wasm });
  const font = await readFile(resolve(
    import.meta.dirname,
    '../../../../../../test/fixtures/fonts/Anton-Regular.ttf'
  ));
  registerLayoutFont(session, asset.fingerprintSha256, font);
});

afterAll(() => {
  dropLayoutSession(session);
});

describe('incremental paragraph WASM differential', () => {
  it.each([
    ['LF', 'First wrapped paragraph\nSecond line\nThird paragraph'],
    ['CRLF', 'First wrapped paragraph\r\nSecond line\r\nThird paragraph'],
    ['Unicode separators', 'First wrapped paragraph\u2028Second line\u2029Third paragraph'],
    ['UTF-16 clusters', 'office e\u0301 😀\nÅ ligature office\nThird paragraph'],
    ['trailing empty line', 'First wrapped paragraph\nSecond line\n']
  ])('matches monolithic Parley output for %s boundaries', (_label, text) => {
    const source = paragraphSource(text);
    const full = realizeFlowText(
      session, 'full', text, source.layout.frame.width,
      paragraph.alignment, paragraph.lineHeightKind, paragraph.lineHeightValue,
      paragraph.firstLineIndent, paragraph.startIndent, paragraph.endIndent,
      paragraph.spaceBefore, paragraph.spaceAfter,
      source.layout.frame.x, source.layout.frame.y, 10_000,
      new Uint32Array([0, text.length, 0, 0, 0]),
      new Float32Array([24, 400, 100, 0]),
      fontStrings, fontRanges
    );
    const fullTables = capture(full);
    full.free();

    const placements: ParagraphFragmentPlacement[] = segmentFlowParagraphs(source).map((segment) => {
      const raw = realizeFlowText(
        session, 'fragment', segment.text, source.layout.frame.width,
        paragraph.alignment, paragraph.lineHeightKind, paragraph.lineHeightValue,
        paragraph.firstLineIndent, paragraph.startIndent, paragraph.endIndent,
        0, 0, 0, 0, 10_000,
        new Uint32Array([0, segment.text.length, 0, 0, 0]),
        new Float32Array([24, 400, 100, 0]),
        fontStrings, fontRanges
      );
      const fragment = capture(raw);
      raw.free();
      return { segment, fragment, paragraph };
    });
    const incremental = assembleParagraphLayout({
      key: 'incremental', source, selectedFonts: [asset], placements, maxGlyphCount: 10_000
    });
    const flattenedGlyphIds = incremental.glyphRuns.flatMap((run) => [...run.glyphIds]);
    const flattenedClusters = incremental.glyphRuns.flatMap((run) => [...run.clusters]);
    const flattenedGeometry = incremental.glyphRuns.flatMap((run) => [...run.geometry]);

    expect(flattenedGlyphIds).toEqual([...fullTables.glyphIds]);
    expect(flattenedClusters).toEqual([...fullTables.clusters]);
    expect(round(flattenedGeometry)).toEqual(round(fullTables.geometry));
    expect(incremental.lines.flatMap((line) => [line.start, line.end])).toEqual([...fullTables.lineMeta]);
    expect(round(incremental.lines.flatMap((line) => [
      line.baseline, line.ascent, line.descent,
      line.bounds.x, line.bounds.y, line.bounds.width, line.bounds.height
    ]))).toEqual(round(fullTables.lineGeometry));
    expect(incremental.caretStops.flatMap((stop) => [
      stop.textOffset, stop.affinity === 'downstream' ? 1 : 0
    ])).toEqual([...fullTables.caretMeta]);
    expect(round(incremental.caretStops.flatMap((stop) => [stop.x, stop.y, stop.height])))
      .toEqual(round(fullTables.caretGeometry));
    expect(incremental.selectionGeometry.flatMap((entry) => [entry.start, entry.end]))
      .toEqual([...fullTables.selectionMeta]);
    expect(round(incremental.selectionGeometry.flatMap((entry) => [
      entry.bounds.x, entry.bounds.y, entry.bounds.width, entry.bounds.height
    ]))).toEqual(round(fullTables.selectionGeometry));
    expect(incremental.clusterMap.flatMap((entry) => [
      entry.textStart, entry.textEnd, entry.glyphStart, entry.glyphEnd
    ])).toEqual([...fullTables.clusterMap]);
    expect(round([
      incremental.inkBounds.x, incremental.inkBounds.y,
      incremental.inkBounds.width, incremental.inkBounds.height,
      incremental.logicalBounds.x, incremental.logicalBounds.y,
      incremental.logicalBounds.width, incremental.logicalBounds.height
    ])).toEqual(round(fullTables.bounds));
  });
});
