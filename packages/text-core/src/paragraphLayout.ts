import type {
  ParagraphTextLayout,
  RealizedParagraphFrame,
  TextLineMetrics
} from './types';

const FRAME_EPSILON = 0.001;

/** Derives frame overflow metadata from realized line geometry. */
export const realizeParagraphFrame = (
  layout: ParagraphTextLayout,
  lines: readonly TextLineMetrics[]
): RealizedParagraphFrame => {
  const frameBottom = layout.frame.y + layout.frame.height;
  const firstOverflowingLine = lines.find((line) => (
    Math.max(line.bounds.y + line.bounds.height, line.baseline + line.descent)
      > frameBottom + FRAME_EPSILON
  ));
  return {
    bounds: { ...layout.frame },
    overflow: layout.overflow,
    overflowed: firstOverflowingLine !== undefined,
    ...(firstOverflowingLine
      ? { firstOverflowTextOffset: firstOverflowingLine.start }
      : {})
  };
};
