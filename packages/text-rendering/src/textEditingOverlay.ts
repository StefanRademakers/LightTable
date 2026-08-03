import type { RealizedTextLayout, Rect } from '@lighttable/text-core';

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
  readonly role: 'caret' | 'baseline' | 'composition' | 'insertion' | 'frame';
  readonly start: TextOverlayPoint;
  readonly end: TextOverlayPoint;
  readonly widthPx: number;
  readonly color: readonly [number, number, number, number];
}

export interface TextEditingOverlay {
  readonly layerId: string;
  /** Excludes blink visibility so the GPU geometry remains reusable. */
  readonly resourceKey: string;
  readonly quads: readonly TextOverlayQuad[];
  readonly lines: readonly TextOverlayLine[];
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
  lines: Object.freeze(frameLines(frame, localToDocument))
});

const selectedGeometry = (
  layout: RealizedTextLayout,
  start: number,
  end: number
) => layout.selectionGeometry.filter((entry) => entry.end > start && entry.start < end);

const caretFor = (
  layout: RealizedTextLayout,
  offset: number,
  affinity: 'upstream' | 'downstream'
) => layout.caretStops.find((stop) => stop.textOffset === offset && stop.affinity === affinity)
  ?? layout.caretStops.find((stop) => stop.textOffset === offset)
  ?? [...layout.caretStops].sort((left, right) => (
    Math.abs(left.textOffset - offset) - Math.abs(right.textOffset - offset)
  ))[0];

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
      points: transformRect(localToDocument, bounds),
      color: [0.16, 0.48, 0.94, 0.34]
    }));
  const lines: TextOverlayLine[] = [];
  if (frame) lines.push(...frameLines(frame, localToDocument));
  lines.push({
      role: 'caret',
      start: transformPoint(localToDocument, caret.x, caret.y),
      end: transformPoint(localToDocument, caret.x, caret.y + caret.height),
      widthPx: 1.5,
      color: [0.96, 0.98, 1, 1]
  });
  lines.push({
      role: 'insertion',
      start: transformPoint(localToDocument, caret.x - 2, caret.y + caret.height + 1),
      end: transformPoint(localToDocument, caret.x + 2, caret.y + caret.height + 1),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.95]
  });
  const activeLine = layout.lines.find((line) => focus >= line.start && focus <= line.end)
    ?? layout.lines[0];
  if (showBaseline && activeLine) {
    lines.push({
      role: 'baseline',
      start: transformPoint(localToDocument, activeLine.bounds.x, activeLine.baseline),
      end: transformPoint(
        localToDocument,
        activeLine.bounds.x + activeLine.bounds.width,
        activeLine.baseline
      ),
      widthPx: 1,
      color: [0.24, 0.66, 1, 0.58]
    });
  }
  if (showBaseline && !activeLine) {
    lines.push({
      role: 'baseline',
      start: transformPoint(localToDocument, caret.x, caret.y + caret.height),
      end: transformPoint(
        localToDocument,
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
        start: transformPoint(localToDocument, bounds.x, bounds.y + bounds.height + 1),
        end: transformPoint(
          localToDocument,
          bounds.x + bounds.width,
          bounds.y + bounds.height + 1
        ),
        widthPx: 1.5,
        color: [0.96, 0.98, 1, 0.94]
      });
    }
  }
  return Object.freeze({
    layerId,
    resourceKey: [
      layerId, layout.key, anchor, focus, caretAffinity,
      composition ? `${composition.start}-${composition.end}` : '-',
      showBaseline ? 1 : 0,
      frame ? `${frame.x},${frame.y},${frame.width},${frame.height}` : '-',
      affineKey(localToDocument)
    ].join(':'),
    quads: Object.freeze(quads),
    lines: Object.freeze(lines)
  });
};
