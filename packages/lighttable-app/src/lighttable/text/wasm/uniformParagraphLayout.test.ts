import { createDefaultFlowTextSource, type ParagraphStyleRun } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { resolveUniformParagraphLayout } from './uniformParagraphLayout';

const paragraph = (change: Partial<ParagraphStyleRun> = {}): ParagraphStyleRun => ({
  ...createDefaultFlowTextSource('A').paragraphRuns[0],
  ...change
});

describe('uniform paragraph WASM adapter', () => {
  it('packs uniform alignment, leading, indents and spacing without dropping values', () => {
    const style = paragraph({
      alignment: 'justify',
      lineHeight: { kind: 'multiple', value: 1.6 },
      firstLineIndent: 8,
      startIndent: 12,
      endIndent: 16,
      spaceBefore: 5,
      spaceAfter: 7
    });
    expect(resolveUniformParagraphLayout({
      paragraphRuns: [style, { ...style, start: 1, end: 2 }]
    })).toEqual({ supported: true, value: {
      alignment: 3,
      lineHeightKind: 2,
      lineHeightValue: 1.6,
      firstLineIndent: 8,
      startIndent: 12,
      endIndent: 16,
      spaceBefore: 5,
      spaceAfter: 7
    } });
  });

  it('refuses mixed paragraph values instead of flattening them', () => {
    const first = paragraph();
    expect(resolveUniformParagraphLayout({
      paragraphRuns: [first, { ...first, start: 1, end: 2, startIndent: 10 }]
    })).toEqual({
      supported: false,
      message: 'Mixed paragraph formatting requires segmented paragraph layout.'
    });
  });

  it('keeps direction and hyphenation gated for runs and empty-flow insertion state', () => {
    expect(resolveUniformParagraphLayout({
      paragraphRuns: [paragraph({ direction: 'rtl' })]
    }).supported).toBe(false);
    const insertion = paragraph({ start: 0, end: 0, hyphenation: 'auto' });
    const { start: _start, end: _end, ...insertionParagraph } = insertion;
    expect(resolveUniformParagraphLayout({
      paragraphRuns: [],
      insertionParagraph
    }).supported).toBe(false);
  });
});
