import type {
  RealizedTextLayout,
  TextRenderingMode,
  TextRunPaint,
  TextSource
} from '@lighttable/text-core';

const flowPaint = (source: Extract<TextSource, { kind: 'flow' }>, index: number) => {
  const run = source.styleRuns[index];
  if (!run) return null;
  const paint: TextRunPaint = {
    ...(run.fill ? { fill: run.fill } : {}),
    ...(run.stroke ? { stroke: run.stroke } : {})
  };
  const renderingMode: TextRenderingMode = run.fill
    ? run.stroke ? 'fill-stroke' : 'fill'
    : run.stroke ? 'stroke' : 'invisible';
  return { paint, renderingMode };
};

const flowStyleIndexAt = (
  source: Extract<TextSource, { kind: 'flow' }>,
  textOffset: number
) => source.styleRuns.findIndex((run) => run.start <= textOffset && textOffset < run.end);

const projectFlowRun = (
  run: RealizedTextLayout['glyphRuns'][number],
  source: Extract<TextSource, { kind: 'flow' }>
) => {
  if (run.clusters.length !== run.glyphIds.length) {
    throw new Error('Cannot project current flow paint: glyph clusters do not match glyph geometry.');
  }
  const chunks: Array<{ start: number; end: number; sourceRunIndex: number }> = [];
  for (let glyphIndex = 0; glyphIndex < run.glyphIds.length; glyphIndex += 1) {
    const sourceRunIndex = flowStyleIndexAt(source, run.clusters[glyphIndex]!);
    const previous = chunks.at(-1);
    if (previous?.sourceRunIndex === sourceRunIndex) previous.end = glyphIndex + 1;
    else chunks.push({ start: glyphIndex, end: glyphIndex + 1, sourceRunIndex });
  }
  return chunks.map(({ start, end, sourceRunIndex }) => {
    const current = flowPaint(source, sourceRunIndex);
    if (!current) {
      throw new Error(`Cannot project current flow paint: source style run ${sourceRunIndex} is unavailable.`);
    }
    const style = source.styleRuns[sourceRunIndex]!;
    return {
      ...run,
      ...current,
      fontResolution: run.fontResolution.kind.startsWith('flow-')
        ? { ...run.fontResolution, sourceRunIndex, requested: style.requestedFont }
        : run.fontResolution,
      glyphIds: run.glyphIds.subarray(start, end),
      clusters: run.clusters.subarray(start, end),
      geometry: run.geometry.subarray(start * 4, end * 4),
      ...(run.transforms ? { transforms: run.transforms.subarray(start * 9, end * 9) } : {})
    };
  });
};

/** Rebinds authored paint without copying immutable glyph geometry or reshaping. */
export const projectCurrentTextPaint = (
  layout: RealizedTextLayout,
  source: TextSource
): RealizedTextLayout => ({
  ...layout,
  glyphRuns: layout.glyphRuns.flatMap((run) => {
    if (source.kind === 'flow') return projectFlowRun(run, source);
    const sourceRunIndex = run.fontResolution.sourceRunIndex;
    const current = source.runs[sourceRunIndex]
        ? {
            paint: source.runs[sourceRunIndex]!.paint,
            renderingMode: source.runs[sourceRunIndex]!.renderingMode
          }
        : null;
    if (!current) {
      throw new Error(`Cannot project current positioned paint: source run ${sourceRunIndex} is unavailable.`);
    }
    return [{ ...run, ...current }];
  })
});
