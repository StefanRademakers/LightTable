import type {
  FlowTextSource,
  ParagraphStyleRun,
  RealizedTextLayout,
  TextStyleRun
} from '@lighttable/text-core';

export interface TextSelectionRange {
  readonly anchor: number;
  readonly focus: number;
}

export interface FlowTextEditResult {
  readonly source: FlowTextSource;
  readonly selection: TextSelectionRange;
}

type RangedRun = { readonly start: number; readonly end: number };

const withoutRange = <Run extends RangedRun>(run: Run): Omit<Run, 'start' | 'end'> => {
  const { start: _start, end: _end, ...properties } = run;
  return properties;
};

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export const orderedTextSelection = (selection: TextSelectionRange) => ({
  start: Math.min(selection.anchor, selection.focus),
  end: Math.max(selection.anchor, selection.focus)
});

export const graphemeStops = (text: string): readonly number[] => {
  const stops = [0];
  for (const segment of graphemeSegmenter.segment(text)) {
    const end = segment.index + segment.segment.length;
    if (end !== stops.at(-1)) stops.push(end);
  }
  if (stops.at(-1) !== text.length) stops.push(text.length);
  return stops;
};

const clampOffset = (text: string, offset: number) => (
  Math.max(0, Math.min(text.length, Math.trunc(Number.isFinite(offset) ? offset : 0)))
);

export const snapTextOffset = (
  text: string,
  offset: number,
  direction: 'backward' | 'forward' | 'nearest' = 'nearest'
) => {
  const clamped = clampOffset(text, offset);
  const stops = graphemeStops(text);
  const forward = stops.find((stop) => stop >= clamped) ?? text.length;
  const backward = [...stops].reverse().find((stop) => stop <= clamped) ?? 0;
  if (direction === 'forward') return forward;
  if (direction === 'backward') return backward;
  return clamped - backward <= forward - clamped ? backward : forward;
};

export const normalizeTextSelection = (
  text: string,
  selection: TextSelectionRange
): TextSelectionRange => ({
  anchor: snapTextOffset(text, selection.anchor),
  focus: snapTextOffset(text, selection.focus)
});

export const moveTextOffset = (
  text: string,
  offset: number,
  direction: 'backward' | 'forward',
  unit: 'grapheme' | 'word' = 'grapheme'
) => {
  const current = snapTextOffset(text, offset, direction);
  if (unit === 'grapheme') {
    const stops = graphemeStops(text);
    return direction === 'backward'
      ? [...stops].reverse().find((stop) => stop < current) ?? 0
      : stops.find((stop) => stop > current) ?? text.length;
  }
  const words = [...wordSegmenter.segment(text)];
  if (direction === 'backward') {
    for (let index = words.length - 1; index >= 0; index -= 1) {
      const word = words[index]!;
      if (word.isWordLike && word.index < current) return word.index;
    }
    return 0;
  }
  for (const word of words) {
    const end = word.index + word.segment.length;
    if (word.isWordLike && end > current) return end;
  }
  return text.length;
};

export const moveTextSelection = (
  text: string,
  selection: TextSelectionRange,
  direction: 'backward' | 'forward',
  options: { readonly extend?: boolean; readonly unit?: 'grapheme' | 'word' } = {}
): TextSelectionRange => {
  const normalized = normalizeTextSelection(text, selection);
  const ordered = orderedTextSelection(normalized);
  if (!options.extend && ordered.start !== ordered.end) {
    const focus = direction === 'backward' ? ordered.start : ordered.end;
    return { anchor: focus, focus };
  }
  const focus = moveTextOffset(text, normalized.focus, direction, options.unit);
  return options.extend ? { anchor: normalized.anchor, focus } : { anchor: focus, focus };
};

export const moveTextSelectionInLayout = (
  layout: RealizedTextLayout,
  selection: TextSelectionRange,
  command: 'line-start' | 'line-end' | 'line-up' | 'line-down',
  extend = false,
  affinity: 'upstream' | 'downstream' = 'downstream',
  preferredX?: number | null
) => {
  const current = layout.caretStops.find(
    (stop) => stop.textOffset === selection.focus && stop.affinity === affinity
  ) ?? layout.caretStops.find((stop) => stop.textOffset === selection.focus);
  if (!current || !layout.lines.length) return { selection, affinity, preferredX: null };
  const currentLineIndex = layout.lines.findIndex(
    (line) => selection.focus >= line.start && selection.focus <= line.end
  );
  const lineIndex = Math.max(0, currentLineIndex);
  let targetOffset: number;
  let targetAffinity = affinity;
  if (command === 'line-start' || command === 'line-end') {
    const line = layout.lines[lineIndex]!;
    targetOffset = command === 'line-start' ? line.start : line.end;
    const stop = layout.caretStops.find((candidate) => candidate.textOffset === targetOffset);
    targetAffinity = stop?.affinity ?? affinity;
  } else {
    const targetLineIndex = command === 'line-up'
      ? Math.max(0, lineIndex - 1)
      : Math.min(layout.lines.length - 1, lineIndex + 1);
    const line = layout.lines[targetLineIndex]!;
    const candidates = layout.caretStops.filter(
      (stop) => stop.textOffset >= line.start && stop.textOffset <= line.end
    );
    const desiredX = preferredX ?? current.x;
    const stop = [...candidates].sort((left, right) => (
      Math.abs(left.x - desiredX) - Math.abs(right.x - desiredX)
    ))[0] ?? current;
    targetOffset = stop.textOffset;
    targetAffinity = stop.affinity;
  }
  return {
    selection: extend
      ? { anchor: selection.anchor, focus: targetOffset }
      : { anchor: targetOffset, focus: targetOffset },
    affinity: targetAffinity,
    preferredX: command === 'line-up' || command === 'line-down'
      ? preferredX ?? current.x
      : null
  };
};

const comparableRun = <Run extends RangedRun>(run: Run) => {
  const { start: _start, end: _end, ...value } = run;
  return JSON.stringify(value);
};

const insertionRun = <Run extends RangedRun>(runs: readonly Run[], offset: number) => (
  runs.find((run) => run.start <= offset && offset < run.end)
  ?? [...runs].reverse().find((run) => run.end <= offset)
  ?? runs.find((run) => run.start >= offset)
);

const spliceRuns = <Run extends RangedRun>(
  runs: readonly Run[],
  start: number,
  end: number,
  insertedLength: number,
  fallback?: Run
): readonly Run[] => {
  const delta = insertedLength - (end - start);
  const result: Run[] = [];
  for (const run of runs) {
    if (run.start < start) {
      result.push({ ...run, end: Math.min(run.end, start) });
    }
  }
  const inherited = fallback ?? insertionRun(runs, start);
  if (insertedLength > 0 && inherited) {
    result.push({ ...inherited, start, end: start + insertedLength });
  }
  for (const run of runs) {
    if (run.end > end) {
      result.push({
        ...run,
        start: Math.max(run.start, end) + delta,
        end: run.end + delta
      });
    }
  }
  const nonEmpty = result.filter((run) => run.end > run.start);
  return nonEmpty.reduce<Run[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous && previous.end === run.start && comparableRun(previous) === comparableRun(run)) {
      merged[merged.length - 1] = { ...previous, end: run.end };
    } else {
      merged.push(run);
    }
    return merged;
  }, []);
};

export const replaceFlowTextSelection = (
  source: FlowTextSource,
  selection: TextSelectionRange,
  replacement: string,
  insertionStyle?: TextStyleRun,
  insertionParagraph?: ParagraphStyleRun
): FlowTextEditResult => {
  const normalized = normalizeTextSelection(source.text, selection);
  const { start, end } = orderedTextSelection(normalized);
  const text = source.text.slice(0, start) + replacement + source.text.slice(end);
  const styleRuns = spliceRuns(
    source.styleRuns, start, end, replacement.length, insertionStyle
  );
  const paragraphRuns = spliceRuns(
    source.paragraphRuns, start, end, replacement.length, insertionParagraph
  );
  const focus = start + replacement.length;
  const retainedStyle = insertionStyle ?? insertionRun(source.styleRuns, start);
  const retainedParagraph = insertionParagraph ?? insertionRun(source.paragraphRuns, start);
  return {
    source: {
      ...source,
      text,
      styleRuns,
      paragraphRuns,
      ...(text.length === 0 && retainedStyle
        ? { insertionStyle: withoutRange(retainedStyle) }
        : {}),
      ...(text.length === 0 && retainedParagraph
        ? { insertionParagraph: withoutRange(retainedParagraph) }
        : {})
    },
    selection: { anchor: focus, focus }
  };
};

export const deleteFlowTextSelection = (
  source: FlowTextSource,
  selection: TextSelectionRange,
  direction: 'backward' | 'forward',
  unit: 'grapheme' | 'word' = 'grapheme'
): FlowTextEditResult => {
  const normalized = normalizeTextSelection(source.text, selection);
  const ordered = orderedTextSelection(normalized);
  const range = ordered.start !== ordered.end
    ? ordered
    : direction === 'backward'
      ? { start: moveTextOffset(source.text, ordered.start, direction, unit), end: ordered.end }
      : { start: ordered.start, end: moveTextOffset(source.text, ordered.end, direction, unit) };
  return replaceFlowTextSelection(source, { anchor: range.start, focus: range.end }, '');
};
