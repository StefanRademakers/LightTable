import {
  createDefaultFlowTextSource,
  type FlowTextSource,
  type ParagraphStyleRun,
  type TextStyleRun
} from '@lighttable/text-core';
import {
  normalizeTextSelection,
  orderedTextSelection,
  type TextSelectionRange
} from './flowTextEditing';

export type TextStyleProperties = Omit<TextStyleRun, 'start' | 'end'>;
export type ParagraphStyleProperties = Omit<ParagraphStyleRun, 'start' | 'end'>;
export type TextStylePatch = Partial<TextStyleProperties>;
export type ParagraphStylePatch = Partial<ParagraphStyleProperties>;

export type MixedValue<Value> =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'mixed' }
  | { readonly kind: 'value'; readonly value: Value };

export interface FlowTextFormatProjection {
  readonly style: MixedValue<TextStyleProperties>;
  readonly paragraph: MixedValue<ParagraphStyleProperties>;
  readonly target: 'selection' | 'insertion' | 'layer';
}

type RangedRun = { readonly start: number; readonly end: number };

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
};

const comparable = (value: unknown) => JSON.stringify(canonicalValue(value));

const withoutRange = <Run extends RangedRun>(run: Run): Omit<Run, 'start' | 'end'> => {
  const { start: _start, end: _end, ...properties } = run;
  return properties;
};

const caretRun = <Run extends RangedRun>(runs: readonly Run[], offset: number): Run | undefined => {
  let low = 0;
  let high = runs.length - 1;
  let preceding: Run | undefined;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const run = runs[middle]!;
    if (offset < run.start) {
      high = middle - 1;
    } else if (offset >= run.end) {
      preceding = run;
      low = middle + 1;
    } else {
      return run;
    }
  }
  return preceding ?? runs[low];
};

const selectedRuns = <Run extends RangedRun>(
  runs: readonly Run[],
  selection: TextSelectionRange | null
) => {
  if (!selection) return runs;
  const { start, end } = orderedTextSelection(selection);
  return start === end
    ? (caretRun(runs, start) ? [caretRun(runs, start)!] : [])
    : runs.filter((run) => run.start < end && run.end > start);
};

const selectedParagraphRange = (
  text: string,
  selection: TextSelectionRange
): TextSelectionRange => {
  const { start, end } = orderedTextSelection(selection);
  const lastSelectedOffset = start === end ? start : end - 1;
  const paragraphStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.min(lastSelectedOffset, text.length));
  const paragraphEnd = nextBreak < 0 ? text.length : nextBreak + 1;
  return { anchor: paragraphStart, focus: paragraphEnd };
};

const mixed = <Value>(values: readonly Value[]): MixedValue<Value> => {
  if (!values.length) return { kind: 'unavailable' };
  const first = comparable(values[0]);
  return values.every((value) => comparable(value) === first)
    ? { kind: 'value', value: values[0]! }
    : { kind: 'mixed' };
};

const mergeRuns = <Run extends RangedRun>(runs: readonly Run[]) => runs.reduce<Run[]>((result, run) => {
  const previous = result.at(-1);
  if (previous && previous.end === run.start
    && comparable(withoutRange(previous)) === comparable(withoutRange(run))) {
    result[result.length - 1] = { ...previous, end: run.end };
  } else {
    result.push(run);
  }
  return result;
}, []);

const applyPatch = <Value extends object>(value: Value, patch: object): Value => {
  const result = { ...value };
  for (const [key, entry] of Object.entries(patch)) {
    if (entry === undefined) delete (result as Record<string, unknown>)[key];
    else (result as Record<string, unknown>)[key] = entry;
  }
  return result;
};

const patchRuns = <Run extends RangedRun>(
  runs: readonly Run[],
  selection: TextSelectionRange | null,
  patch: Partial<Omit<Run, 'start' | 'end'>>
) => {
  if (!Object.keys(patch).length) return runs;
  if (!selection) return mergeRuns(runs.map((run) => applyPatch(run, patch)));
  const { start, end } = orderedTextSelection(selection);
  if (start === end) return runs;
  const result: Run[] = [];
  for (const run of runs) {
    if (run.end <= start || run.start >= end) {
      result.push(run);
      continue;
    }
    if (run.start < start) result.push({ ...run, end: start });
    result.push(applyPatch({ ...run, start: Math.max(run.start, start), end: Math.min(run.end, end) }, patch));
    if (run.end > end) result.push({ ...run, start: end });
  }
  return mergeRuns(result);
};

export const projectFlowTextFormat = (
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  insertionStyle?: TextStyleRun,
  insertionParagraph?: ParagraphStyleRun
): FlowTextFormatProjection => {
  selection = selection ? normalizeTextSelection(source.text, selection) : null;
  const ordered = selection ? orderedTextSelection(selection) : null;
  const insertion = ordered !== null && ordered.start === ordered.end;
  const styles = insertion
    ? [insertionStyle
      ? withoutRange(insertionStyle)
      : source.insertionStyle
        ?? (caretRun(source.styleRuns, ordered!.start)
          ? withoutRange(caretRun(source.styleRuns, ordered!.start)!) : undefined)]
        .filter((value): value is TextStyleProperties => value !== undefined)
    : selectedRuns(source.styleRuns, selection).map(withoutRange);
  const paragraphs = insertion
    ? [insertionParagraph
      ? withoutRange(insertionParagraph)
      : source.insertionParagraph
        ?? (caretRun(source.paragraphRuns, ordered!.start)
          ? withoutRange(caretRun(source.paragraphRuns, ordered!.start)!) : undefined)]
        .filter((value): value is ParagraphStyleProperties => value !== undefined)
    : selectedRuns(source.paragraphRuns, selection).map(withoutRange);
  return {
    style: mixed(styles),
    paragraph: mixed(paragraphs),
    target: !selection ? 'layer' : insertion ? 'insertion' : 'selection'
  };
};

export const projectFlowTextStyleProperty = <Key extends keyof TextStyleProperties>(
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  property: Key,
  insertionStyle?: TextStyleRun
): MixedValue<TextStyleProperties[Key]> => projectFlowTextStyleValue(
  source, selection, (style) => style[property], insertionStyle
);

export const projectFlowTextStyleValue = <Value>(
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  project: (style: TextStyleProperties) => Value,
  insertionStyle?: TextStyleRun
): MixedValue<Value> => {
  selection = selection ? normalizeTextSelection(source.text, selection) : null;
  const ordered = selection ? orderedTextSelection(selection) : null;
  if (ordered && ordered.start === ordered.end) {
    const style = insertionStyle
      ? withoutRange(insertionStyle)
      : source.insertionStyle
        ?? (caretRun(source.styleRuns, ordered.start)
          ? withoutRange(caretRun(source.styleRuns, ordered.start)!) : undefined);
    return style ? { kind: 'value', value: project(style) } : { kind: 'unavailable' };
  }
  if (!selection && source.styleRuns.length === 0 && source.insertionStyle) {
    return { kind: 'value', value: project(source.insertionStyle) };
  }
  if (!selection && source.styleRuns.length === 0) {
    return { kind: 'value', value: project(withoutRange(createDefaultFlowTextSource('x').styleRuns[0])) };
  }
  return mixed(selectedRuns(source.styleRuns, selection).map((run) => project(withoutRange(run))));
};

export const projectFlowTextParagraphProperty = <Key extends keyof ParagraphStyleProperties>(
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  property: Key,
  insertionParagraph?: ParagraphStyleRun
): MixedValue<ParagraphStyleProperties[Key]> => {
  selection = selection ? normalizeTextSelection(source.text, selection) : null;
  const ordered = selection ? orderedTextSelection(selection) : null;
  if (ordered && ordered.start === ordered.end) {
    const paragraph = insertionParagraph
      ?? (source.insertionParagraph
        ? { ...source.insertionParagraph, start: 0, end: 0 }
        : caretRun(source.paragraphRuns, ordered.start));
    return paragraph
      ? { kind: 'value', value: paragraph[property] }
      : { kind: 'unavailable' };
  }
  if (source.paragraphRuns.length === 0) {
    const paragraph = insertionParagraph ?? source.insertionParagraph;
    if (paragraph) return { kind: 'value', value: paragraph[property] };
    return {
      kind: 'value',
      value: createDefaultFlowTextSource('x').paragraphRuns[0][property]
    };
  }
  return mixed(selectedRuns(source.paragraphRuns, selection).map((run) => run[property]));
};

export const formatFlowTextSource = (
  source: FlowTextSource,
  selection: TextSelectionRange | null,
  stylePatch: TextStylePatch,
  paragraphPatch: ParagraphStylePatch = {},
  insertionStyle?: TextStyleRun,
  insertionParagraph?: ParagraphStyleRun
): FlowTextSource => {
  selection = selection ? normalizeTextSelection(source.text, selection) : null;
  const ordered = selection ? orderedTextSelection(selection) : null;
  if (ordered && ordered.start === ordered.end) {
    const styleSeed = insertionStyle
      ? withoutRange(insertionStyle)
      : source.insertionStyle
        ?? (caretRun(source.styleRuns, ordered.start)
          ? withoutRange(caretRun(source.styleRuns, ordered.start)!) : undefined);
    const paragraphSeed = insertionParagraph
      ? withoutRange(insertionParagraph)
      : source.insertionParagraph
        ?? (caretRun(source.paragraphRuns, ordered.start)
          ? withoutRange(caretRun(source.paragraphRuns, ordered.start)!) : undefined);
    return {
      ...source,
      paragraphRuns: patchRuns(
        source.paragraphRuns,
        selectedParagraphRange(source.text, selection!),
        paragraphPatch
      ),
      ...(styleSeed ? { insertionStyle: applyPatch(styleSeed, stylePatch) } : {}),
      ...(paragraphSeed ? { insertionParagraph: applyPatch(paragraphSeed, paragraphPatch) } : {})
    };
  }
  const defaultSource = source.text.length === 0 ? createDefaultFlowTextSource('x') : null;
  const emptyStyleSeed = source.insertionStyle
    ?? (defaultSource ? withoutRange(defaultSource.styleRuns[0]) : undefined);
  const emptyParagraphSeed = source.insertionParagraph
    ?? (defaultSource ? withoutRange(defaultSource.paragraphRuns[0]) : undefined);
  return {
    ...source,
    styleRuns: patchRuns(source.styleRuns, selection, stylePatch),
    paragraphRuns: patchRuns(
      source.paragraphRuns,
      selection ? selectedParagraphRange(source.text, selection) : null,
      paragraphPatch
    ),
    ...(!selection && source.styleRuns.length === 0 && emptyStyleSeed
      ? { insertionStyle: applyPatch(emptyStyleSeed, stylePatch) } : {}),
    ...(!selection && source.paragraphRuns.length === 0 && emptyParagraphSeed
      ? { insertionParagraph: applyPatch(emptyParagraphSeed, paragraphPatch) } : {})
  };
};
