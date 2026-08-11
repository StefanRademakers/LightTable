import type { DeformationPoint } from './deformationSurface';

const signedArea2 = (a: DeformationPoint, b: DeformationPoint, c: DeformationPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const topologySafe = (
  source: readonly DeformationPoint[],
  target: readonly DeformationPoint[],
  indices: readonly number[],
  minimumAreaRatio: number
) => {
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]!;
    const b = indices[index + 1]!;
    const c = indices[index + 2]!;
    const sourceArea = signedArea2(source[a]!, source[b]!, source[c]!);
    if (Math.abs(sourceArea) < 1e-5) continue;
    const targetArea = signedArea2(target[a]!, target[b]!, target[c]!);
    if (Math.sign(targetArea) !== Math.sign(sourceArea)
      || Math.abs(targetArea) < Math.abs(sourceArea) * minimumAreaRatio) return false;
  }
  return true;
};

/** Line-searches a deformation back toward source before a triangle folds. */
export const preventTriangleFoldovers = <Point extends DeformationPoint>(
  source: readonly Point[],
  desired: readonly Point[],
  indices: readonly number[],
  minimumAreaRatio = 0.025
): Point[] => {
  if (indices.length === 0 || topologySafe(source, desired, indices, minimumAreaRatio)) {
    return desired.map((point) => ({ ...point }));
  }
  const atScale = (scale: number) => desired.map((point, index) => ({
      ...point,
      x: source[index]!.x + (point.x - source[index]!.x) * scale,
      y: source[index]!.y + (point.y - source[index]!.y) * scale
    }));

  // Find the largest safe fraction continuously. The previous geometric
  // fallback (1 -> .75 -> .4875...) visibly snapped a mesh backwards whenever
  // a pointer crossed one of those coarse thresholds.
  let safe = 0;
  let unsafe = 1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidateScale = (safe + unsafe) * 0.5;
    if (topologySafe(source, atScale(candidateScale), indices, minimumAreaRatio)) {
      safe = candidateScale;
    } else {
      unsafe = candidateScale;
    }
  }
  return atScale(safe);
};

/**
 * Limits one incremental edit from an already valid target. Unlike the
 * source-relative fallback above, this never rescales previous accepted
 * edits and therefore cannot make an interactive mesh jump backwards.
 */
export const preventIncrementalTriangleFoldovers = <Point extends DeformationPoint>(
  source: readonly Point[],
  accepted: readonly Point[],
  desired: readonly Point[],
  indices: readonly number[],
  minimumAreaRatio = 0.025
): Point[] => {
  if (indices.length === 0 || topologySafe(source, desired, indices, minimumAreaRatio)) {
    return desired.map((point) => ({ ...point }));
  }
  if (!topologySafe(source, accepted, indices, minimumAreaRatio)) {
    return preventTriangleFoldovers(source, desired, indices, minimumAreaRatio);
  }
  const atScale = (scale: number) => desired.map((point, index) => ({
    ...point,
    x: accepted[index]!.x + (point.x - accepted[index]!.x) * scale,
    y: accepted[index]!.y + (point.y - accepted[index]!.y) * scale
  }));
  let safe = 0;
  let unsafe = 1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = (safe + unsafe) * 0.5;
    if (topologySafe(source, atScale(candidate), indices, minimumAreaRatio)) safe = candidate;
    else unsafe = candidate;
  }
  return atScale(safe);
};
