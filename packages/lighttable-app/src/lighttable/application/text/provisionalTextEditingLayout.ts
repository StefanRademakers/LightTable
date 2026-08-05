import type { CaretStop, RealizedTextLayout } from '@lighttable/text-core';

const commonPrefixLength = (left: string, right: string) => {
  let offset = 0;
  while (offset < left.length && offset < right.length && left[offset] === right[offset]) offset += 1;
  return offset;
};

const commonSuffixLength = (left: string, right: string, prefix: number) => {
  let length = 0;
  while (
    left.length - length > prefix
    && right.length - length > prefix
    && left[left.length - length - 1] === right[right.length - length - 1]
  ) length += 1;
  return length;
};

const advanceText = (
  value: string,
  origin: Pick<CaretStop, 'x' | 'y' | 'height'>,
  advance: number,
  lineStartX: number
) => {
  let x = origin.x;
  let y = origin.y;
  for (const character of Array.from(value)) {
    if (character === '\n' || character === '\r') {
      x = lineStartX;
      y += Math.max(1, origin.height) * 1.2;
    } else {
      x += advance;
    }
  }
  return { x, y };
};

interface ProvisionalLayoutMetrics {
  readonly stops: readonly CaretStop[];
  readonly advance: number;
}

const metricsCache = new WeakMap<RealizedTextLayout, ProvisionalLayoutMetrics>();

const caretAt = (stops: readonly CaretStop[], offset: number) => {
  let low = 0;
  let high = stops.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stops[middle]!.textOffset < offset) low = middle + 1;
    else high = middle;
  }
  if (stops[low]?.textOffset === offset) {
    let index = low;
    while (stops[index]?.textOffset === offset) {
      if (stops[index]!.affinity === 'downstream') return stops[index]!;
      index += 1;
    }
    return stops[low]!;
  }
  const previous = stops[low - 1] ?? null;
  const next = stops[low] ?? null;
  if (!previous) return next;
  if (!next) return previous;
  return offset - previous.textOffset <= next.textOffset - offset ? previous : next;
};

const estimatedAdvance = (stops: readonly CaretStop[]) => {
  const samples: number[] = [];
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]!;
    const current = stops[index]!;
    const units = current.textOffset - previous.textOffset;
    const advance = current.x - previous.x;
    if (units > 0 && advance > 0 && Math.abs(current.y - previous.y) < 0.5) {
      samples.push(advance / units);
    }
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)]
    ?? Math.max(1, (stops.find(({ height }) => height > 0)?.height ?? 16) * 0.55);
};

const metricsFor = (layout: RealizedTextLayout): ProvisionalLayoutMetrics => {
  const cached = metricsCache.get(layout);
  if (cached) return cached;
  const stops = Object.freeze([...layout.caretStops]
    .sort((left, right) => left.textOffset - right.textOffset || left.x - right.x));
  const metrics = Object.freeze({ stops, advance: estimatedAdvance(stops) });
  metricsCache.set(layout, metrics);
  return metrics;
};

/**
 * Projects caret feedback through the newest local text edit while exact
 * HarfBuzz/Parley shaping is still in flight. Document pixels remain backed
 * by the last exact GPU source; the provisional layout is overlay-only.
 */
export const buildProvisionalTextEditingLayout = (
  layout: RealizedTextLayout,
  exactText: string,
  currentText: string,
  offsets: readonly number[],
  affinity: CaretStop['affinity'] = 'downstream'
): RealizedTextLayout => {
  if (exactText === currentText || layout.warp || layout.caretStops.length === 0) return layout;
  const { stops, advance } = metricsFor(layout);
  if (layout.glyphRuns.some((run) => run.direction === 'ttb' || run.direction === 'btt')) return layout;
  const prefix = commonPrefixLength(exactText, currentText);
  const suffix = commonSuffixLength(exactText, currentText, prefix);
  const oldChangeEnd = exactText.length - suffix;
  const newChangeEnd = currentText.length - suffix;
  const startCaret = caretAt(stops, prefix);
  const oldEndCaret = caretAt(stops, oldChangeEnd);
  if (!startCaret || !oldEndCaret) return layout;
  const lineStartX = layout.paragraphFrame?.bounds.x
    ?? Math.min(...stops.filter((stop) => Math.abs(stop.y - startCaret.y) < 0.5)
      .map((stop) => stop.x), startCaret.x);
  const insertedEnd = advanceText(
    currentText.slice(prefix, newChangeEnd), startCaret, advance, lineStartX
  );
  const shiftX = insertedEnd.x - oldEndCaret.x;
  const shiftY = insertedEnd.y - oldEndCaret.y;
  const delta = currentText.length - exactText.length;
  const synthetic = [...new Set(offsets)].flatMap((requestedOffset) => {
    const offset = Math.max(0, Math.min(currentText.length, requestedOffset));
    let base: CaretStop | null;
    let x: number;
    if (offset <= prefix) {
      base = caretAt(stops, offset);
      x = base?.x ?? startCaret.x;
    } else if (offset < newChangeEnd) {
      base = startCaret;
      const advanced = advanceText(
        currentText.slice(prefix, offset), startCaret, advance, lineStartX
      );
      x = advanced.x;
    } else {
      base = caretAt(stops, offset - delta) ?? oldEndCaret;
      x = base.x + shiftX;
    }
    let y = offset > prefix && offset < newChangeEnd
      ? advanceText(currentText.slice(prefix, offset), startCaret, advance, lineStartX).y
      : (base?.y ?? startCaret.y) + (offset >= newChangeEnd ? shiftY : 0);
    const height = Math.max(1, base?.height ?? startCaret.height);
    const frame = layout.paragraphFrame?.bounds;
    if (frame && frame.width > 0 && x > frame.x + frame.width) {
      const line = Math.floor((x - frame.x) / frame.width);
      x = frame.x + ((x - frame.x) % frame.width);
      y += line * height * 1.2;
    }
    return [{ textOffset: offset, x, y, height, affinity } satisfies CaretStop];
  });
  return Object.freeze({
    ...layout,
    key: `${layout.key}:provisional:${currentText.length}:${prefix}:${suffix}`,
    caretStops: Object.freeze([...layout.caretStops, ...synthetic])
  });
};
