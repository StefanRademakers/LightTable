import type {
  ParagraphTextLayout,
  PointTextLayout,
  RealizedTextLayout,
  Rect
} from '@lighttable/text-core';

export type VerticalFlowLayout = (PointTextLayout | ParagraphTextLayout) & {
  readonly writingMode: 'vertical-rl' | 'vertical-lr';
};

interface VerticalProjection {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

const projectionFor = (layout: VerticalFlowLayout): VerticalProjection => {
  if (layout.mode === 'point') {
    return layout.writingMode === 'vertical-rl'
      ? { a: 0, b: 1, c: -1, d: 0, tx: layout.origin.x + layout.origin.y, ty: layout.origin.y - layout.origin.x }
      : { a: 0, b: 1, c: 1, d: 0, tx: layout.origin.x - layout.origin.y, ty: layout.origin.y - layout.origin.x };
  }
  return layout.writingMode === 'vertical-rl'
    ? {
        a: 0, b: 1, c: -1, d: 0,
        tx: layout.frame.x + layout.frame.width + layout.frame.y,
        ty: layout.frame.y - layout.frame.x
      }
    : {
        a: 0, b: 1, c: 1, d: 0,
        tx: layout.frame.x - layout.frame.y,
        ty: layout.frame.y - layout.frame.x
      };
};

const point = (projection: VerticalProjection, x: number, y: number) => ({
  x: projection.a * x + projection.c * y + projection.tx,
  y: projection.b * x + projection.d * y + projection.ty
});

const vector = (projection: VerticalProjection, x: number, y: number) => ({
  x: projection.a * x + projection.c * y,
  y: projection.b * x + projection.d * y
});

const rect = (projection: VerticalProjection, source: Rect): Rect => {
  const corners = [
    point(projection, source.x, source.y),
    point(projection, source.x + source.width, source.y),
    point(projection, source.x, source.y + source.height),
    point(projection, source.x + source.width, source.y + source.height)
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const glyphTransform = (projection: VerticalProjection) => new Float32Array([
  projection.a, projection.c, 0,
  projection.b, projection.d, 0,
  0, 0, 1
]);

/**
 * Projects exact horizontal WASM shaping into CSS/PDF-style vertical columns.
 * The glyph outlines remain GPU vectors. Latin glyphs use sideways orientation;
 * vertical alternates can replace this adapter later without changing storage.
 */
export const projectHorizontalLayoutToVertical = (
  horizontal: RealizedTextLayout,
  layout: VerticalFlowLayout
): RealizedTextLayout => {
  const projection = projectionFor(layout);
  const perGlyphTransform = glyphTransform(projection);
  return {
    ...horizontal,
    glyphRuns: horizontal.glyphRuns.map((run) => {
      const geometry = new Float32Array(run.geometry.length);
      for (let index = 0; index < run.glyphIds.length; index += 1) {
        const offset = index * 4;
        const origin = point(projection, run.geometry[offset]!, run.geometry[offset + 1]!);
        const advance = vector(projection, run.geometry[offset + 2]!, run.geometry[offset + 3]!);
        geometry.set([origin.x, origin.y, advance.x, advance.y], offset);
      }
      const transforms = new Float32Array(run.glyphIds.length * 9);
      for (let index = 0; index < run.glyphIds.length; index += 1) {
        transforms.set(perGlyphTransform, index * 9);
      }
      return { ...run, direction: 'ttb' as const, geometry, transforms };
    }),
    lines: horizontal.lines.map((line) => ({
      ...line,
      baseline: point(projection, 0, line.baseline).x,
      bounds: rect(projection, line.bounds)
    })),
    caretStops: horizontal.caretStops.map((caret) => ({
      ...caret,
      ...point(projection, caret.x, caret.y)
    })),
    selectionGeometry: horizontal.selectionGeometry.map((selection) => ({
      ...selection,
      bounds: rect(projection, selection.bounds)
    })),
    inkBounds: rect(projection, horizontal.inkBounds),
    logicalBounds: rect(projection, horizontal.logicalBounds),
    ...(layout.mode === 'paragraph' ? {
      paragraphFrame: {
        bounds: { ...layout.frame },
        overflow: layout.overflow,
        overflowed: horizontal.paragraphFrame?.overflowed ?? false,
        ...(horizontal.paragraphFrame?.firstOverflowTextOffset === undefined ? {} : {
          firstOverflowTextOffset: horizontal.paragraphFrame.firstOverflowTextOffset
        })
      }
    } : {})
  };
};

export const horizontalLayoutForVertical = (
  layout: VerticalFlowLayout
): PointTextLayout | ParagraphTextLayout => {
  if (layout.mode === 'point') {
    return { ...layout, writingMode: 'horizontal-tb' };
  }
  return {
    ...layout,
    frame: {
      x: layout.frame.x,
      y: layout.frame.y,
      width: layout.frame.height,
      height: layout.frame.width
    },
    writingMode: 'horizontal-tb'
  };
};
