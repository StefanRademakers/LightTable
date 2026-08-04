import type {
  FlowTextSource,
  ParagraphStyleRun,
  TextStyleRun
} from '@lighttable/text-core';

export interface ParagraphStyleSlice {
  readonly sourceRunIndex: number;
  readonly run: ParagraphStyleRun;
}

export interface TextStyleSlice {
  readonly sourceRunIndex: number;
  readonly run: TextStyleRun;
}

export interface FlowParagraphSegment {
  readonly index: number;
  /** UTF-16 offsets in the complete authored flow. */
  readonly start: number;
  readonly end: number;
  /** Includes the authored paragraph separator, when present. */
  readonly text: string;
  readonly textStyles: readonly TextStyleSlice[];
  readonly paragraphStyles: readonly ParagraphStyleSlice[];
}

const localTextStyles = (
  runs: readonly TextStyleRun[],
  start: number,
  end: number
): readonly TextStyleSlice[] => runs.flatMap((run, sourceRunIndex) => {
  const intersectionStart = Math.max(start, run.start);
  const intersectionEnd = Math.min(end, run.end);
  return intersectionStart < intersectionEnd ? [{
    sourceRunIndex,
    run: {
      ...run,
      start: intersectionStart - start,
      end: intersectionEnd - start
    }
  }] : [];
});

const localParagraphStyles = (
  runs: readonly ParagraphStyleRun[],
  start: number,
  end: number
): readonly ParagraphStyleSlice[] => runs.flatMap((run, sourceRunIndex) => {
  const intersectionStart = Math.max(start, run.start);
  const intersectionEnd = Math.min(end, run.end);
  return intersectionStart < intersectionEnd ? [{
    sourceRunIndex,
    run: {
      ...run,
      start: intersectionStart - start,
      end: intersectionEnd - start
    }
  }] : [];
});

/**
 * Splits a canonical flow into independently shapeable paragraph units.
 *
 * JavaScript string indexes are UTF-16 offsets, matching the text document
 * contract. CRLF remains one separator. A trailing separator stays attached
 * to the final non-empty fragment: Parley already emits its terminal empty
 * line, so manufacturing another zero-length fragment would duplicate it.
 */
export const segmentFlowParagraphs = (
  source: Pick<FlowTextSource, 'text' | 'styleRuns' | 'paragraphRuns'>
): readonly FlowParagraphSegment[] => {
  const ranges: Array<readonly [number, number]> = [];
  const separators = /\r\n|[\r\n\u2028\u2029]/gu;
  let start = 0;
  for (const match of source.text.matchAll(separators)) {
    const separatorStart = match.index;
    const end = separatorStart + match[0].length;
    ranges.push([start, end]);
    start = end;
  }
  if (start < source.text.length || ranges.length === 0) {
    ranges.push([start, source.text.length]);
  }

  return ranges.map(([paragraphStart, paragraphEnd], index) => ({
    index,
    start: paragraphStart,
    end: paragraphEnd,
    text: source.text.slice(paragraphStart, paragraphEnd),
    textStyles: localTextStyles(source.styleRuns, paragraphStart, paragraphEnd),
    paragraphStyles: localParagraphStyles(source.paragraphRuns, paragraphStart, paragraphEnd)
  }));
};

const orderedRecord = <T>(record: Readonly<Record<string, T>>) => (
  Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
);

const shapingStyleIdentity = ({ run }: TextStyleSlice) => [
  // Global style indexes deliberately stay out of the key. The fragment
  // stores local slots and maps those to the current flow during assembly.
  run.start,
  run.end,
  run.requestedFont.families,
  run.requestedFont.postScriptName ?? null,
  run.requestedFont.preferredAsset
    ? [
        run.requestedFont.preferredAsset.assetId,
        run.requestedFont.preferredAsset.faceIndex,
        run.requestedFont.preferredAsset.fingerprintSha256
      ]
    : null,
  run.fontSize,
  run.fontWeight,
  run.fontStyle,
  run.fontStretch,
  run.tracking,
  run.kerning,
  run.baselineShift,
  run.horizontalScale,
  run.verticalScale,
  run.language ?? null,
  run.scriptOverride ?? null,
  run.directionOverride ?? null,
  orderedRecord(run.openTypeFeatures),
  orderedRecord(run.variableAxes),
  run.syntheticBold,
  run.syntheticItalic,
  run.underline ?? false
];

const paragraphStyleIdentity = ({ run }: ParagraphStyleSlice) => [
  // Global paragraph-run indexes can shift when an earlier paragraph changes.
  run.start,
  run.end,
  run.alignment,
  run.direction,
  run.lineHeight.kind,
  'value' in run.lineHeight ? run.lineHeight.value : null,
  run.firstLineIndent,
  run.startIndent,
  run.endIndent,
  // Paragraph spacing only translates cached fragments during assembly.
  run.hyphenation
];

/** Stable, collision-free Map key for paragraph-local shaping output. */
export const createParagraphShapeCacheKey = (
  segment: FlowParagraphSegment,
  frameWidth: number | undefined,
  fontSnapshotRevision: number
): string => JSON.stringify([
  'paragraph-shape-v1',
  fontSnapshotRevision,
  frameWidth ?? null,
  segment.text,
  segment.textStyles.map(shapingStyleIdentity),
  segment.paragraphStyles.map(paragraphStyleIdentity)
]);
