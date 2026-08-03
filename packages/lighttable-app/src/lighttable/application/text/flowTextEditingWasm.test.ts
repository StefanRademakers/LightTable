import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RealizedTextLayout } from '@lighttable/text-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initializeTextLayoutWasm, {
  drop_layout_session as dropLayoutSession,
  realize_flow_text as realizeFlowText,
  register_layout_font as registerLayoutFont
} from '../../text/wasm/generated/text_layout_wasm.js';
import {
  moveTextSelectionHorizontallyInLayout,
  moveTextSelectionInLayout
} from './flowTextEditing';

const session = 'vitest-bidi-editing:1';

beforeAll(async () => {
  const wasm = await readFile(resolve(
    import.meta.dirname,
    '../../text/wasm/generated/text_layout_wasm_bg.wasm'
  ));
  await initializeTextLayoutWasm({ module_or_path: wasm });
  const fixtureRoot = resolve(import.meta.dirname, '../../../../../../test/fixtures/fonts');
  registerLayoutFont(session, 'anton', await readFile(resolve(fixtureRoot, 'Anton-Regular.ttf')));
  registerLayoutFont(
    session,
    'hebrew',
    await readFile(resolve(fixtureRoot, 'NotoSansHebrew-Slice06.ttf'))
  );
});

afterAll(() => {
  dropLayoutSession(session);
});

const mixedBidiLayout = (twoLines = false): RealizedTextLayout => {
  const text = twoLines
    ? `ABC \u05e9\u05dc\u05d5\u05dd\nDEF \u05e2\u05d5\u05dc\u05dd`
    : `ABC \u05e9\u05dc\u05d5\u05dd`;
  const runs = twoLines ? [
    { start: 0, end: 4, family: 'Anton', asset: 'anton' },
    { start: 4, end: 9, family: 'Noto Sans Hebrew', asset: 'hebrew' },
    { start: 9, end: 13, family: 'Anton', asset: 'anton' },
    { start: 13, end: text.length, family: 'Noto Sans Hebrew', asset: 'hebrew' }
  ] : [
    { start: 0, end: 4, family: 'Anton', asset: 'anton' },
    { start: 4, end: text.length, family: 'Noto Sans Hebrew', asset: 'hebrew' }
  ];
  const chunks = runs.flatMap((run) => [run.family, run.asset]);
  const offsets: number[] = [];
  let byteOffset = 0;
  for (const chunk of chunks) {
    offsets.push(byteOffset);
    byteOffset += new TextEncoder().encode(chunk).byteLength;
    offsets.push(byteOffset);
  }
  const encoded = new TextEncoder().encode(chunks.join(''));
  const raw = realizeFlowText(
    session, 'mixed-bidi-editing', text, 500,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_000,
    new Uint32Array(runs.flatMap((run, index) => [run.start, run.end, index, 0, 0])),
    new Float32Array(runs.flatMap(() => [24, 400, 100, 0])),
    encoded,
    new Uint32Array(offsets)
  );
  const lineMeta = raw.line_meta();
  const lineGeometry = raw.line_geometry();
  const caretMeta = raw.caret_meta();
  const caretGeometry = raw.caret_geometry();
  const runMeta = raw.run_meta();
  expect([...runMeta].filter((_value, index) => index % 5 === 1)).toContain(1);
  const layout: RealizedTextLayout = {
    schemaVersion: 2,
    key: raw.key,
    glyphRuns: [],
    lines: Array.from({ length: lineMeta.length / 2 }, (_, index) => ({
      start: lineMeta[index * 2]!,
      end: lineMeta[index * 2 + 1]!,
      baseline: lineGeometry[index * 7]!,
      ascent: lineGeometry[index * 7 + 1]!,
      descent: lineGeometry[index * 7 + 2]!,
      bounds: {
        x: lineGeometry[index * 7 + 3]!, y: lineGeometry[index * 7 + 4]!,
        width: lineGeometry[index * 7 + 5]!, height: lineGeometry[index * 7 + 6]!
      }
    })),
    caretStops: Array.from({ length: caretMeta.length / 2 }, (_, index) => ({
      textOffset: caretMeta[index * 2]!,
      affinity: caretMeta[index * 2 + 1] === 1 ? 'downstream' as const : 'upstream' as const,
      x: caretGeometry[index * 3]!,
      y: caretGeometry[index * 3 + 1]!,
      height: caretGeometry[index * 3 + 2]!
    })),
    selectionGeometry: [], clusterMap: [], warnings: [],
    inkBounds: { x: 0, y: 0, width: 500, height: 100 },
    logicalBounds: { x: 0, y: 0, width: 500, height: 100 }
  };
  raw.free();
  return layout;
};

describe('real WASM bidi editing contract', () => {
  it('walks Parley caret positions in visual order while retaining logical offsets', () => {
    const layout = mixedBidiLayout();
    const visual = [...layout.caretStops].sort((left, right) => left.x - right.x);
    expect(visual.some((stop, index) => index > 0 && stop.textOffset < visual[index - 1]!.textOffset))
      .toBe(true);

    let selection = { anchor: visual[0]!.textOffset, focus: visual[0]!.textOffset };
    let affinity = visual[0]!.affinity;
    const visited = [`${selection.focus}:${affinity}`];
    for (let index = 1; index < visual.length; index += 1) {
      const result = moveTextSelectionHorizontallyInLayout(
        layout, selection, 'forward', false, affinity
      );
      selection = result.selection;
      affinity = result.affinity;
      visited.push(`${selection.focus}:${affinity}`);
    }
    expect(visited).toEqual(visual.map((stop) => `${stop.textOffset}:${stop.affinity}`));
    expect(moveTextSelectionInLayout(
      layout, selection, 'line-start', false, affinity
    ).selection.focus).toBe(visual[0]!.textOffset);
    expect(moveTextSelectionInLayout(
      layout, selection, 'line-end', false, affinity
    ).selection.focus).toBe(visual.at(-1)!.textOffset);
  });

  it('collapses a mixed-direction range toward its visual edge', () => {
    const layout = mixedBidiLayout();
    const visual = [...layout.caretStops].sort((left, right) => left.x - right.x);
    const left = visual[1]!;
    const right = visual.at(-2)!;
    const selection = { anchor: right.textOffset, focus: left.textOffset };
    expect(moveTextSelectionHorizontallyInLayout(
      layout, selection, 'backward', false, left.affinity
    ).selection).toEqual({ anchor: left.textOffset, focus: left.textOffset });
    expect(moveTextSelectionHorizontallyInLayout(
      layout, selection, 'forward', false, right.affinity
    ).selection).toEqual({ anchor: right.textOffset, focus: right.textOffset });
  });

  it('preserves the logical anchor during vertical mixed-bidi extension', () => {
    const layout = mixedBidiLayout(true);
    expect(layout.lines).toHaveLength(2);
    const firstLine = layout.lines[0]!;
    const secondLine = layout.lines[1]!;
    const start = layout.caretStops.find((stop) => (
      stop.textOffset >= firstLine.start && stop.textOffset <= firstLine.end
    ))!;
    const secondLineStops = layout.caretStops.filter((stop) => (
      stop.textOffset >= secondLine.start && stop.textOffset <= secondLine.end
    ));
    const expected = [...secondLineStops].sort((left, right) => (
      Math.abs(left.x - start.x) - Math.abs(right.x - start.x)
    ))[0]!;
    const down = moveTextSelectionInLayout(
      layout,
      { anchor: start.textOffset, focus: start.textOffset },
      'line-down',
      true,
      start.affinity
    );
    expect(down.selection).toEqual({ anchor: start.textOffset, focus: expected.textOffset });
    expect(down.preferredX).toBe(start.x);
    const up = moveTextSelectionInLayout(
      layout, down.selection, 'line-up', true, down.affinity, down.preferredX
    );
    expect(up.selection).toEqual({ anchor: start.textOffset, focus: start.textOffset });
  });
});
