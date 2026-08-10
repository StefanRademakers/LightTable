export interface SubjectMaskCandidate {
  readonly score: number;
  readonly data: Uint8Array;
}

/**
 * Ranks prompt-generated masks without pretending SlimSAM has semantic
 * subject labels. Model confidence remains primary; weak photographic priors
 * reject empty/full-frame masks and prefer a dominant, non-border background.
 */
export const rankSubjectMask = (
  candidate: SubjectMaskCandidate,
  width: number,
  height: number
) => {
  let area = 0;
  let border = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((candidate.data[y * width + x] ?? 0) <= 127) continue;
      area += 1;
      centroidX += x;
      centroidY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border += 1;
    }
  }
  if (area === 0) return -Infinity;
  const areaRatio = area / (width * height);
  if (areaRatio < 0.01 || areaRatio > 0.92) return -Infinity;
  const dx = centroidX / area / Math.max(1, width - 1) - 0.5;
  const dy = centroidY / area / Math.max(1, height - 1) - 0.5;
  const centrality = 1 - Math.min(1, Math.hypot(dx, dy) / 0.707);
  const borderPenalty = Math.min(1, border / Math.max(1, 2 * width + 2 * height - 4));
  const dominantArea = 1 - Math.min(1, Math.abs(areaRatio - 0.34) / 0.58);
  return candidate.score + centrality * 0.10 + dominantArea * 0.08 - borderPenalty * 0.22;
};
