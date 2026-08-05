import type { RealizedTextLayout, Rect } from '@lighttable/text-core';
import { warpTextPoint } from './textWarp';

export interface TextEditingAffine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface TextOverlayPoint { readonly x: number; readonly y: number }

export interface TextOverlayQuad {
  readonly role: 'selection';
  readonly points: readonly [TextOverlayPoint, TextOverlayPoint, TextOverlayPoint, TextOverlayPoint];
  readonly color: readonly [number, number, number, number];
}

export interface TextOverlayLine {
  readonly role: 'caret' | 'baseline' | 'composition' | 'insertion' | 'frame' | 'path-baseline' | 'path-direction';
  readonly start: TextOverlayPoint;
  readonly end: TextOverlayPoint;
  readonly widthPx: number;
  readonly color: readonly [number, number, number, number];
}

export interface TextOverlayMarker {
  readonly role:
    | 'frame-handle'
    | 'overflow-indicator'
    | 'path-start-handle'
    | 'path-end-handle'
    | 'path-direction-handle';
  readonly point: TextOverlayPoint;
  readonly sizePx: number;
}

export interface TextEditingOverlay {
  readonly layerId: string;
  /** Excludes blink visibility so the GPU geometry remains reusable. */
  readonly resourceKey: string;
  readonly quads: readonly TextOverlayQuad[];
  /** Expensive path/frame guides retained independently of caret/selection changes. */
  readonly staticLines?: readonly TextOverlayLine[];
  readonly lines: readonly TextOverlayLine[];
  readonly markers: readonly TextOverlayMarker[];
  readonly geometryKeys?: Readonly<{
    quads?: string;
    caret?: string;
    lines?: string;
    staticLines?: string;
    markers?: string;
  }>;
}

export interface BuildTextEditingOverlayOptions {
  readonly layerId: string;
  readonly layout: RealizedTextLayout;
  readonly localToDocument: TextEditingAffine;
  readonly anchor: number;
  readonly focus: number;
  readonly caretAffinity?: 'upstream' | 'downstream';
  readonly composition?: { readonly start: number; readonly end: number } | null;
  readonly showBaseline?: boolean;
  readonly frame?: Rect | null;
}

export interface BuildParagraphFrameOverlayOptions {
  readonly layerId: string;
  readonly frame: Rect;
  readonly localToDocument: TextEditingAffine;
}

const transformPoint = (matrix: TextEditingAffine, x: number, y: number) => ({
  x: matrix.a * x + matrix.c * y + matrix.tx,
  y: matrix.b * x + matrix.d * y + matrix.ty
});

const transformRect = (matrix: TextEditingAffine, bounds: Rect) => [
  transformPoint(matrix, bounds.x, bounds.y),
  transformPoint(matrix, bounds.x + bounds.width, bounds.y),
  transformPoint(matrix, bounds.x + bounds.width, bounds.y + bounds.height),
  transformPoint(matrix, bounds.x, bounds.y + bounds.height)
] as const;

const affineKey = (matrix: TextEditingAffine) => [
  matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty
].join(',');

const frameLines = (
  frame: Rect,
  localToDocument: TextEditingAffine
): TextOverlayLine[] => {
  const points = transformRect(localToDocument, frame);
  return points.map((start, index) => ({
    role: 'frame' as const,
    start,
    end: points[(index + 1) % points.length]!,
    widthPx: 1,
    color: [0.24, 0.66, 1, 0.95] as const
  }));
};

const midpoint = (first: TextOverlayPoint, second: TextOverlayPoint): TextOverlayPoint => ({
  x: (first.x + second.x) * 0.5,
  y: (first.y + second.y) * 0.5
});

const frameMarkers = (
  frame: Rect,
  localToDocument: TextEditingAffine
): TextOverlayMarker[] => {
  const [northWest, northEast, southEast, southWest] = transformRect(localToDocument, frame);
  return [
    northWest, midpoint(northWest, northEast), northEast,
    midpoint(northEast, southEast), southEast, midpoint(southEast, southWest),
    southWest, midpoint(southWest, northWest)
  ].map((point) => ({ role: 'frame-handle' as const, point, sizePx: 10 }));
};

const overflowMarker = (
  frame: Rect,
  localToDocument: TextEditingAffine
): TextOverlayMarker => ({
  role: 'overflow-indicator',
  point: transformPoint(localToDocument, frame.x + frame.width, frame.y + frame.height),
  sizePx: 12
});

export const buildParagraphFrameOverlay = ({
  layerId,
  frame,
  localToDocument
}: BuildParagraphFrameOverlayOptions): TextEditingOverlay => Object.freeze({
  layerId,
  resourceKey: [
    layerId, 'paragraph-frame', frame.x, frame.y, frame.width, frame.height,
    affineKey(localToDocument)
  ].join(':'),
  quads: Object.freeze([]),
  lines: Object.freeze(frameLines(frame, localToDocument)),
  markers: Object.freeze(frameMarkers(frame, localToDocument))
});

const selectedGeometry = (
  layout: RealizedTextLayout,
  start: number,
  end: number
) => {
  if (start >= end || layout.selectionGeometry.length === 0) return [];
  let low = 0;
  let high = layout.selectionGeometry.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (layout.selectionGeometry[middle]!.end <= start) low = middle + 1;
    else high = middle;
  }
  const selected: RealizedTextLayout['selectionGeometry'][number][] = [];
  for (let index = low; index < layout.selectionGeometry.length; index += 1) {
    const entry = layout.selectionGeometry[index]!;
    if (entry.start >= end) break;
    if (entry.end > start) selected.push(entry);
  }
  return selected;
};

interface LayoutOverlayIndex {
  readonly carets: ReadonlyMap<string, RealizedTextLayout['caretStops'][number]>;
  readonly firstCaretByOffset: ReadonlyMap<number, RealizedTextLayout['caretStops'][number]>;
  readonly sortedCarets: readonly RealizedTextLayout['caretStops'][number][];
}

const overlayIndexes = new WeakMap<RealizedTextLayout, LayoutOverlayIndex>();

const overlayIndex = (layout: RealizedTextLayout): LayoutOverlayIndex => {
  const existing = overlayIndexes.get(layout);
  if (existing) return existing;
  const carets = new Map<string, RealizedTextLayout['caretStops'][number]>();
  const firstCaretByOffset = new Map<number, RealizedTextLayout['caretStops'][number]>();
  for (const stop of layout.caretStops) {
    carets.set(`${stop.textOffset}:${stop.affinity}`, stop);
    if (!firstCaretByOffset.has(stop.textOffset)) firstCaretByOffset.set(stop.textOffset, stop);
  }
  const index = {
    carets,
    firstCaretByOffset,
    sortedCarets: [...firstCaretByOffset.values()].sort((left, right) => left.textOffset - right.textOffset)
  };
  overlayIndexes.set(layout, index);
  return index;
};

const caretFor = (
  layout: RealizedTextLayout,
  offset: number,
  affinity: 'upstream' | 'downstream'
) => {
  const index = overlayIndex(layout);
  const exact = index.carets.get(`${offset}:${affinity}`) ?? index.firstCaretByOffset.get(offset);
  if (exact || index.sortedCarets.length === 0) return exact;
  let low = 0;
  let high = index.sortedCarets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.sortedCarets[middle]!.textOffset < offset) low = middle + 1;
    else high = middle;
  }
  const after = index.sortedCarets[low];
  const before = low > 0 ? index.sortedCarets[low - 1] : undefined;
  if (!before) return after;
  if (!after) return before;
  return offset - before.textOffset <= after.textOffset - offset ? before : after;
};

export const buildTextEditingOverlay = ({
  layerId,
  layout,
  localToDocument,
  anchor,
  focus,
  caretAffinity = 'downstream',
  composition = null,
  showBaseline = true,
  frame = null
}: BuildTextEditingOverlayOptions): TextEditingOverlay => {
  const projectPoint = (x: number, y: number) => {
    const point = layout.warp
      ? warpTextPoint({ x, y }, layout.warp, layout.logicalBounds)
      : { x, y };
    return transformPoint(localToDocument, point.x, point.y);
  };
  const projectRect = (bounds: Rect) => [
    projectPoint(bounds.x, bounds.y),
    projectPoint(bounds.x + bounds.width, bounds.y),
    projectPoint(bounds.x + bounds.width, bounds.y + bounds.height),
    projectPoint(bounds.x, bounds.y + bounds.height)
  ] as const;
  const selectionStart = Math.min(anchor, focus);
  const selectionEnd = Math.max(anchor, focus);
  const caret = caretFor(layout, focus, caretAffinity) ?? {
    textOffset: 0,
    x: layout.logicalBounds.x,
    y: layout.logicalBounds.y,
    height: Math.max(1, layout.logicalBounds.height || 16),
    affinity: 'downstream' as const
  };
  const quads: TextOverlayQuad[] = selectedGeometry(layout, selectionStart, selectionEnd)
    .map(({ bounds }) => ({
      role: 'selection',
      points: projectRect(bounds),
      color: [0.16, 0.48, 0.94, 0.34]
    }));
  const lines: TextOverlayLine[] = [];
  const vertical = layout.glyphRuns.some((run) => run.direction === 'ttb' || run.direction === 'btt');
  if (frame) lines.push(...frameLines(frame, localToDocument));
  const caretStart = projectPoint(caret.x, caret.y);
  const caretEnd = vertical
    ? projectPoint(caret.x + caret.height, caret.y)
    : projectPoint(caret.x, caret.y + caret.height);
  // A blue outer rail plus white core stays visible over light, dark and
  // saturated artwork without sampling or recompositing document pixels.
  lines.push({
      role: 'caret',
      start: caretStart,
      end: caretEnd,
      widthPx: 3.5,
      color: [0.08, 0.38, 0.96, 1]
  });
  lines.push({
      role: 'caret',
      start: caretStart,
      end: caretEnd,
      widthPx: 1.25,
      color: [0.96, 0.98, 1, 1]
  });
  lines.push({
      role: 'insertion',
      start: vertical
        ? projectPoint(caret.x + caret.height + 1, caret.y - 2)
        : projectPoint(caret.x - 2, caret.y + caret.height + 1),
      end: vertical
        ? projectPoint(caret.x + caret.height + 1, caret.y + 2)
        : projectPoint(caret.x + 2, caret.y + caret.height + 1),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.95]
  });
  const activeLine = layout.lines.find((line) => focus >= line.start && focus <= line.end)
    ?? layout.lines[0];
  if (showBaseline && activeLine) {
    lines.push({
      role: 'baseline',
      start: vertical
        ? projectPoint(activeLine.baseline, activeLine.bounds.y)
        : projectPoint(activeLine.bounds.x, activeLine.baseline),
      end: vertical
        ? projectPoint(activeLine.baseline, activeLine.bounds.y + activeLine.bounds.height)
        : projectPoint(activeLine.bounds.x + activeLine.bounds.width, activeLine.baseline),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.58]
    });
  }
  if (showBaseline && !activeLine) {
    lines.push({
      role: 'baseline',
      start: projectPoint(caret.x, caret.y + caret.height),
      end: projectPoint(
        caret.x + Math.max(12, caret.height * 0.75),
        caret.y + caret.height
      ),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.58]
    });
  }
  if (composition && composition.start !== composition.end) {
    for (const { bounds } of selectedGeometry(layout, composition.start, composition.end)) {
      lines.push({
        role: 'composition',
        start: vertical
          ? projectPoint(bounds.x + bounds.width + 1, bounds.y)
          : projectPoint(bounds.x, bounds.y + bounds.height + 1),
        end: vertical
          ? projectPoint(bounds.x + bounds.width + 1, bounds.y + bounds.height)
          : projectPoint(bounds.x + bounds.width, bounds.y + bounds.height + 1),
        widthPx: 1.5,
        color: [0.96, 0.98, 1, 0.94]
      });
    }
  }
  const showOverflowIndicator = Boolean(
    frame
    && layout.paragraphFrame?.overflow === 'indicator'
    && layout.paragraphFrame.overflowed
  );
  return Object.freeze({
    layerId,
    resourceKey: [
      layerId, layout.key, anchor, focus, caretAffinity,
      composition ? `${composition.start}-${composition.end}` : '-',
      showBaseline ? 1 : 0,
      frame ? `${frame.x},${frame.y},${frame.width},${frame.height}` : '-',
      showOverflowIndicator ? 'overflow' : 'fits',
      layout.warp ? JSON.stringify(layout.warp) : 'no-warp',
      affineKey(localToDocument)
    ].join(':'),
    quads: Object.freeze(quads),
    lines: Object.freeze(lines),
    markers: Object.freeze(frame
      ? [
          ...frameMarkers(frame, localToDocument),
          ...(showOverflowIndicator ? [overflowMarker(frame, localToDocument)] : [])
        ]
      : [])
  });
};
