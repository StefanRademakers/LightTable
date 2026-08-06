import type { FlowTextSource, ParagraphStyleRun } from '@lighttable/text-core';

export interface UniformParagraphLayout {
  readonly alignment: 0 | 1 | 2 | 3;
  readonly lineHeightKind: 0 | 1 | 2;
  readonly lineHeightValue: number;
  readonly firstLineIndent: number;
  readonly startIndent: number;
  readonly endIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
}

export type UniformParagraphLayoutResolution =
  | { readonly supported: true; readonly value: UniformParagraphLayout }
  | { readonly supported: false; readonly message: string };

const sameLineHeight = (left: ParagraphStyleRun['lineHeight'], right: ParagraphStyleRun['lineHeight']) => (
  left.kind === right.kind
  && (left.kind === 'normal' || (right.kind !== 'normal' && left.value === right.value))
);

const sameSupportedFormatting = (left: ParagraphStyleRun, right: ParagraphStyleRun) => (
  left.alignment === right.alignment
  && left.direction === right.direction
  && sameLineHeight(left.lineHeight, right.lineHeight)
  && left.firstLineIndent === right.firstLineIndent
  && left.startIndent === right.startIndent
  && left.endIndent === right.endIndent
  && left.spaceBefore === right.spaceBefore
  && left.spaceAfter === right.spaceAfter
);

/** Packs the currently supported whole-flow paragraph subset without silently flattening mixed runs. */
export const resolveUniformParagraphLayout = (
  source: Pick<FlowTextSource, 'paragraphRuns' | 'insertionParagraph'>
): UniformParagraphLayoutResolution => {
  const paragraph = source.paragraphRuns[0] ?? source.insertionParagraph;
  if (!paragraph) {
    return { supported: true, value: {
      alignment: 0,
      lineHeightKind: 0,
      lineHeightValue: 0,
      firstLineIndent: 0,
      startIndent: 0,
      endIndent: 0,
      spaceBefore: 0,
      spaceAfter: 0
    } };
  }
  // Parley/HarfBuzz resolves Unicode bidi order from the paragraph contents.
  // Retain the authored base direction for interchange and use that exact bidi
  // result here; a future segmented adapter can additionally force neutral-only
  // paragraphs without changing the canonical model.
  // The canonical source retains automatic hyphenation. Until the segmented
  // paragraph adapter can insert language-specific breaks, rendering the same
  // text without discretionary hyphens is a safe visual approximation; it
  // must not take down every text layer in the document coordinator.
  if (source.paragraphRuns.some((candidate) => !sameSupportedFormatting(candidate, paragraph))) {
    return {
      supported: false,
      message: 'Mixed paragraph formatting requires segmented paragraph layout.'
    };
  }
  return { supported: true, value: {
    alignment: paragraph.alignment === 'center' ? 1
      : paragraph.alignment === 'end' ? 2
        : paragraph.alignment === 'justify' ? 3 : 0,
    lineHeightKind: paragraph.lineHeight.kind === 'absolute' ? 1
      : paragraph.lineHeight.kind === 'multiple' ? 2 : 0,
    lineHeightValue: paragraph.lineHeight.kind === 'normal' ? 0 : paragraph.lineHeight.value,
    firstLineIndent: paragraph.firstLineIndent,
    startIndent: paragraph.startIndent,
    endIndent: paragraph.endIndent,
    spaceBefore: paragraph.spaceBefore,
    spaceAfter: paragraph.spaceAfter
  } };
};
