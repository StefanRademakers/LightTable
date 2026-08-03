import { describe, expect, it } from 'vitest';
import { createDefaultFlowTextSource } from '@lighttable/text-core';
import {
  createParagraphShapeCacheKey,
  segmentFlowParagraphs
} from './incrementalParagraphLayout';

describe('incremental paragraph layout identity', () => {
  it('segments every document paragraph in UTF-16 without splitting CRLF or surrogate pairs', () => {
    const source = createDefaultFlowTextSource('A😀\r\nB\u2028');
    const segments = segmentFlowParagraphs(source);

    expect(segments.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
      { start: 0, end: 5, text: 'A😀\r\n' },
      { start: 5, end: 7, text: 'B\u2028' }
    ]);
    expect(segments[0].textStyles[0]).toMatchObject({
      sourceRunIndex: 0,
      run: { start: 0, end: 5 }
    });
    expect(segments[1].textStyles[0]).toMatchObject({
      sourceRunIndex: 0,
      run: { start: 0, end: 2 }
    });
    expect(segments).toHaveLength(2);
  });

  it('changes only the edited paragraph identity in a large flow', () => {
    const before = createDefaultFlowTextSource('First paragraph.\nSecond paragraph.\nThird paragraph.');
    const after = createDefaultFlowTextSource('First paragraph.\nSecond changed paragraph.\nThird paragraph.');
    const beforeKeys = segmentFlowParagraphs(before)
      .map((segment) => createParagraphShapeCacheKey(segment, 240, 4));
    const afterKeys = segmentFlowParagraphs(after)
      .map((segment) => createParagraphShapeCacheKey(segment, 240, 4));

    expect(afterKeys[0]).toBe(beforeKeys[0]);
    expect(afterKeys[1]).not.toBe(beforeKeys[1]);
    expect(afterKeys[2]).toBe(beforeKeys[2]);
  });

  it('invalidates shaping for metrics, paragraph layout, width and fonts but not paint', () => {
    const source = createDefaultFlowTextSource('Paragraph');
    const segment = segmentFlowParagraphs(source)[0];
    const base = createParagraphShapeCacheKey(segment, 240, 1);
    const recolored = segmentFlowParagraphs({
      ...source,
      styleRuns: source.styleRuns.map((run) => ({
        ...run,
        fill: {
          kind: 'solid' as const,
          color: { colorSpace: 'srgb' as const, r: 1, g: 0, b: 0, a: 1 }
        }
      }))
    })[0];
    const resized = segmentFlowParagraphs({
      ...source,
      styleRuns: source.styleRuns.map((run) => ({ ...run, fontSize: run.fontSize + 1 }))
    })[0];
    const reindented = segmentFlowParagraphs({
      ...source,
      paragraphRuns: source.paragraphRuns.map((run) => ({ ...run, startIndent: 12 }))
    })[0];
    const respaced = segmentFlowParagraphs({
      ...source,
      paragraphRuns: source.paragraphRuns.map((run) => ({ ...run, spaceBefore: 12, spaceAfter: 8 }))
    })[0];

    expect(createParagraphShapeCacheKey(recolored, 240, 1)).toBe(base);
    expect(createParagraphShapeCacheKey(resized, 240, 1)).not.toBe(base);
    expect(createParagraphShapeCacheKey(reindented, 240, 1)).not.toBe(base);
    expect(createParagraphShapeCacheKey(respaced, 240, 1)).toBe(base);
    expect(createParagraphShapeCacheKey(segment, 320, 1)).not.toBe(base);
    expect(createParagraphShapeCacheKey(segment, 240, 2)).not.toBe(base);
  });

  it('does not stale an unchanged suffix when earlier global style indexes shift', () => {
    const base = createDefaultFlowTextSource('AB\nCD');
    const styled = {
      ...base,
      styleRuns: [
        { ...base.styleRuns[0], end: 3 },
        { ...base.styleRuns[0], start: 3 }
      ]
    };
    const shifted = {
      ...base,
      styleRuns: [
        { ...base.styleRuns[0], end: 1 },
        { ...base.styleRuns[0], start: 1, end: 3 },
        { ...base.styleRuns[0], start: 3 }
      ]
    };
    const styledSuffix = segmentFlowParagraphs(styled)[1];
    const shiftedSuffix = segmentFlowParagraphs(shifted)[1];

    expect(styledSuffix.textStyles[0].sourceRunIndex).toBe(1);
    expect(shiftedSuffix.textStyles[0].sourceRunIndex).toBe(2);
    expect(createParagraphShapeCacheKey(styledSuffix, 240, 1))
      .toBe(createParagraphShapeCacheKey(shiftedSuffix, 240, 1));
  });

  it('canonicalizes OpenType and variable-axis record order', () => {
    const source = createDefaultFlowTextSource('Paragraph');
    const left = segmentFlowParagraphs({
      ...source,
      styleRuns: source.styleRuns.map((run) => ({
        ...run,
        openTypeFeatures: { liga: true, kern: 1 },
        variableAxes: { wght: 500, wdth: 90 }
      }))
    })[0];
    const right = segmentFlowParagraphs({
      ...source,
      styleRuns: source.styleRuns.map((run) => ({
        ...run,
        openTypeFeatures: { kern: 1, liga: true },
        variableAxes: { wdth: 90, wght: 500 }
      }))
    })[0];

    expect(createParagraphShapeCacheKey(left, 240, 1))
      .toBe(createParagraphShapeCacheKey(right, 240, 1));
  });
});
