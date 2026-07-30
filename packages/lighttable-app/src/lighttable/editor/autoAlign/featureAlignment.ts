export interface AlignmentRaster {
  width: number;
  height: number;
  luma: Float32Array;
  valid: Uint8Array;
}

export interface AlignmentFeature {
  x: number;
  y: number;
  response: number;
  level: number;
  angle: number;
  descriptor: Uint32Array;
}

export interface AlignmentFeatureMatch {
  reference: AlignmentFeature;
  target: AlignmentFeature;
  distance: number;
  secondDistance: number;
}

export interface SimilarityTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export interface FeatureAlignmentEvidence {
  detectedReferenceFeatures: number;
  detectedTargetFeatures: number;
  candidateMatches: number;
  mutualMatches: number;
  inlierCount: number;
  inlierRatio: number;
  coverageCells: number;
  coverageRatio: number;
  overlap: number;
  medianResidual: number;
  p90Residual: number;
  identityMedianResidual: number;
  estimatedScale: number;
  estimatedRotationDegrees: number;
  model: 'translation' | 'similarity';
}

export interface FeatureAlignmentEstimate {
  transform: SimilarityTransform;
  evidence: FeatureAlignmentEvidence;
  confidence: number;
  inlierMatches: AlignmentFeatureMatch[];
}

interface PyramidLevel extends AlignmentRaster {
  level: number;
  toBaseX: number;
  toBaseY: number;
}

interface ScoredTransform {
  transform: SimilarityTransform;
  inliers: AlignmentFeatureMatch[];
  residuals: number[];
  medianResidual: number;
  p90Residual: number;
}

const DESCRIPTOR_WORDS = 8;
const DESCRIPTOR_BITS = DESCRIPTOR_WORDS * 32;
const DESCRIPTOR_RADIUS = 11;
const MAX_FEATURES = 1400;
const MAX_MATCHES_FOR_RANSAC = 400;
const RANSAC_ITERATIONS = 3200;
const RANSAC_THRESHOLD = 3.25;
const PYRAMID_SCALE = 1.2;
const MAX_PYRAMID_LEVELS = 7;
const MIN_PYRAMID_DIMENSION = 56;
const BUCKET_COLUMNS = 8;
const BUCKET_ROWS = 8;
const FEATURES_PER_BUCKET = 28;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const median = (values: number[]) => {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const percentile = (values: number[], fraction: number) => {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

const bilinear = (values: Float32Array, width: number, height: number, x: number, y: number) => {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = safeX - x0;
  const fy = safeY - y0;
  const top = values[y0 * width + x0] * (1 - fx) + values[y0 * width + x1] * fx;
  const bottom = values[y1 * width + x0] * (1 - fx) + values[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
};

const resizeRaster = (source: PyramidLevel, width: number, height: number, level: number): PyramidLevel => {
  const luma = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const index = y * width + x;
      luma[index] = bilinear(source.luma, source.width, source.height, sourceX, sourceY);
      const nearestX = clamp(Math.round(sourceX), 0, source.width - 1);
      const nearestY = clamp(Math.round(sourceY), 0, source.height - 1);
      valid[index] = source.valid[nearestY * source.width + nearestX];
    }
  }
  return {
    width,
    height,
    luma,
    valid,
    level,
    toBaseX: source.toBaseX * scaleX,
    toBaseY: source.toBaseY * scaleY
  };
};

const buildPyramid = (raster: AlignmentRaster) => {
  const levels: PyramidLevel[] = [{
    ...raster,
    level: 0,
    toBaseX: 1,
    toBaseY: 1
  }];
  for (let level = 1; level < MAX_PYRAMID_LEVELS; level += 1) {
    const previous = levels[level - 1];
    const width = Math.floor(raster.width / Math.pow(PYRAMID_SCALE, level));
    const height = Math.floor(raster.height / Math.pow(PYRAMID_SCALE, level));
    if (Math.min(width, height) < MIN_PYRAMID_DIMENSION) break;
    levels.push(resizeRaster(previous, width, height, level));
  }
  return levels;
};

const createIntegral = (values: Float32Array, width: number, height: number) => {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  return integral;
};

const integralSum = (
  integral: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) => {
  const stride = width + 1;
  return integral[y1 * stride + x1]
    - integral[y0 * stride + x1]
    - integral[y1 * stride + x0]
    + integral[y0 * stride + x0];
};

const descriptorPattern = (() => {
  let state = 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const offsets = new Int8Array(DESCRIPTOR_BITS * 4);
  for (let index = 0; index < DESCRIPTOR_BITS; index += 1) {
    for (let point = 0; point < 2; point += 1) {
      let x = 0;
      let y = 0;
      do {
        x = (next() % (DESCRIPTOR_RADIUS * 2 + 1)) - DESCRIPTOR_RADIUS;
        y = (next() % (DESCRIPTOR_RADIUS * 2 + 1)) - DESCRIPTOR_RADIUS;
      } while (x * x + y * y > DESCRIPTOR_RADIUS * DESCRIPTOR_RADIUS);
      offsets[index * 4 + point * 2] = x;
      offsets[index * 4 + point * 2 + 1] = y;
    }
  }
  return offsets;
})();

const featureOrientation = (level: PyramidLevel, x: number, y: number) => {
  const radius = 8;
  let momentX = 0;
  let momentY = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius) continue;
      const value = level.luma[(y + offsetY) * level.width + x + offsetX];
      momentX += offsetX * value;
      momentY += offsetY * value;
    }
  }
  return Math.atan2(momentY, momentX);
};

const describeFeature = (level: PyramidLevel, x: number, y: number, angle: number) => {
  const descriptor = new Uint32Array(DESCRIPTOR_WORDS);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (let bit = 0; bit < DESCRIPTOR_BITS; bit += 1) {
    const base = bit * 4;
    const ax = descriptorPattern[base];
    const ay = descriptorPattern[base + 1];
    const bx = descriptorPattern[base + 2];
    const by = descriptorPattern[base + 3];
    const sampleA = bilinear(
      level.luma,
      level.width,
      level.height,
      x + cosine * ax - sine * ay,
      y + sine * ax + cosine * ay
    );
    const sampleB = bilinear(
      level.luma,
      level.width,
      level.height,
      x + cosine * bx - sine * by,
      y + sine * bx + cosine * by
    );
    if (sampleA < sampleB) descriptor[bit >>> 5] |= (1 << (bit & 31)) >>> 0;
  }
  return descriptor;
};

const detectLevelFeatures = (level: PyramidLevel): AlignmentFeature[] => {
  const { width, height, luma, valid } = level;
  const gradientX = new Float32Array(width * height);
  const gradientY = new Float32Array(width * height);
  const xx = new Float32Array(width * height);
  const yy = new Float32Array(width * height);
  const xy = new Float32Array(width * height);
  const response = new Float32Array(width * height);
  let maximumResponse = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!valid[index]) continue;
      const gx = (
        luma[(y - 1) * width + x + 1] + 2 * luma[y * width + x + 1] + luma[(y + 1) * width + x + 1]
        - luma[(y - 1) * width + x - 1] - 2 * luma[y * width + x - 1] - luma[(y + 1) * width + x - 1]
      ) * 0.25;
      const gy = (
        luma[(y + 1) * width + x - 1] + 2 * luma[(y + 1) * width + x] + luma[(y + 1) * width + x + 1]
        - luma[(y - 1) * width + x - 1] - 2 * luma[(y - 1) * width + x] - luma[(y - 1) * width + x + 1]
      ) * 0.25;
      gradientX[index] = gx;
      gradientY[index] = gy;
      xx[index] = gx * gx;
      yy[index] = gy * gy;
      xy[index] = gx * gy;
    }
  }

  const integralXX = createIntegral(xx, width, height);
  const integralYY = createIntegral(yy, width, height);
  const integralXY = createIntegral(xy, width, height);
  const windowRadius = 2;
  const margin = DESCRIPTOR_RADIUS + 2;
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const index = y * width + x;
      if (!valid[index]) continue;
      const x0 = x - windowRadius;
      const y0 = y - windowRadius;
      const x1 = x + windowRadius + 1;
      const y1 = y + windowRadius + 1;
      const sumXX = integralSum(integralXX, width, x0, y0, x1, y1);
      const sumYY = integralSum(integralYY, width, x0, y0, x1, y1);
      const sumXY = integralSum(integralXY, width, x0, y0, x1, y1);
      const determinant = sumXX * sumYY - sumXY * sumXY;
      const trace = sumXX + sumYY;
      const value = determinant - 0.045 * trace * trace;
      if (value > 0) {
        response[index] = value;
        maximumResponse = Math.max(maximumResponse, value);
      }
    }
  }

  if (maximumResponse <= 1e-12) return [];
  const threshold = maximumResponse * 0.006;
  const candidates: AlignmentFeature[] = [];
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const index = y * width + x;
      const value = response[index];
      if (value < threshold) continue;
      let isMaximum = true;
      for (let offsetY = -2; offsetY <= 2 && isMaximum; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          if (response[(y + offsetY) * width + x + offsetX] > value) {
            isMaximum = false;
            break;
          }
        }
      }
      if (!isMaximum) continue;
      const angle = featureOrientation(level, x, y);
      candidates.push({
        x: (x + 0.5) * level.toBaseX - 0.5,
        y: (y + 0.5) * level.toBaseY - 0.5,
        response: value,
        level: level.level,
        angle,
        descriptor: describeFeature(level, x, y, angle)
      });
    }
  }
  return candidates;
};

export const detectAlignmentFeatures = (raster: AlignmentRaster) => {
  const buckets = Array.from(
    { length: BUCKET_COLUMNS * BUCKET_ROWS },
    () => [] as AlignmentFeature[]
  );
  for (const level of buildPyramid(raster)) {
    for (const feature of detectLevelFeatures(level)) {
      const column = clamp(Math.floor(feature.x / raster.width * BUCKET_COLUMNS), 0, BUCKET_COLUMNS - 1);
      const row = clamp(Math.floor(feature.y / raster.height * BUCKET_ROWS), 0, BUCKET_ROWS - 1);
      buckets[row * BUCKET_COLUMNS + column].push(feature);
    }
  }
  return buckets
    .flatMap((bucket) => bucket
      .sort((left, right) => right.response - left.response)
      .slice(0, FEATURES_PER_BUCKET))
    .sort((left, right) => right.response - left.response)
    .slice(0, MAX_FEATURES);
};

const popcount32 = (value: number) => {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const descriptorDistance = (left: Uint32Array, right: Uint32Array) => {
  let distance = 0;
  for (let index = 0; index < DESCRIPTOR_WORDS; index += 1) {
    distance += popcount32(left[index] ^ right[index]);
  }
  return distance;
};

interface NearestMatch {
  bestIndex: number;
  bestDistance: number;
  secondDistance: number;
}

const nearestDescriptors = (queries: AlignmentFeature[], candidates: AlignmentFeature[]) =>
  queries.map((query): NearestMatch => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let secondDistance = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      const distance = descriptorDistance(query.descriptor, candidate.descriptor);
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        bestIndex = index;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    });
    return { bestIndex, bestDistance, secondDistance };
  });

export const matchAlignmentFeatures = (
  reference: AlignmentFeature[],
  target: AlignmentFeature[]
) => {
  if (reference.length < 2 || target.length < 2) return [];
  const forward = nearestDescriptors(reference, target);
  const reverse = nearestDescriptors(target, reference);
  return forward
    .map((nearest, referenceIndex): AlignmentFeatureMatch | null => {
      if (nearest.bestIndex < 0 || nearest.bestDistance > 104) return null;
      if (nearest.bestDistance >= nearest.secondDistance * 0.82) return null;
      if (reverse[nearest.bestIndex]?.bestIndex !== referenceIndex) return null;
      return {
        reference: reference[referenceIndex],
        target: target[nearest.bestIndex],
        distance: nearest.bestDistance,
        secondDistance: nearest.secondDistance
      };
    })
    .filter((match): match is AlignmentFeatureMatch => Boolean(match))
    .sort((left, right) => left.distance - right.distance);
};

const transformPoint = (transform: SimilarityTransform, x: number, y: number) => ({
  x: transform.a * x - transform.b * y + transform.tx,
  y: transform.b * x + transform.a * y + transform.ty
});

const inverseTransform = (transform: SimilarityTransform): SimilarityTransform | null => {
  const determinant = transform.a * transform.a + transform.b * transform.b;
  if (determinant < 1e-12) return null;
  const a = transform.a / determinant;
  const b = -transform.b / determinant;
  return {
    a,
    b,
    tx: -a * transform.tx + b * transform.ty,
    ty: -b * transform.tx - a * transform.ty
  };
};

const symmetricResidual = (transform: SimilarityTransform, match: AlignmentFeatureMatch) => {
  const forward = transformPoint(transform, match.reference.x, match.reference.y);
  const forwardError = Math.hypot(
    forward.x - match.target.x,
    forward.y - match.target.y
  );
  const inverse = inverseTransform(transform);
  if (!inverse) return Number.POSITIVE_INFINITY;
  const backward = transformPoint(inverse, match.target.x, match.target.y);
  const backwardError = Math.hypot(
    backward.x - match.reference.x,
    backward.y - match.reference.y
  );
  return (forwardError + backwardError) * 0.5;
};

const fitTranslation = (matches: AlignmentFeatureMatch[]): SimilarityTransform => ({
  a: 1,
  b: 0,
  tx: median(matches.map((match) => match.target.x - match.reference.x)),
  ty: median(matches.map((match) => match.target.y - match.reference.y))
});

const fitSimilarityPair = (
  first: AlignmentFeatureMatch,
  second: AlignmentFeatureMatch
): SimilarityTransform | null => {
  const referenceX = second.reference.x - first.reference.x;
  const referenceY = second.reference.y - first.reference.y;
  const targetX = second.target.x - first.target.x;
  const targetY = second.target.y - first.target.y;
  const denominator = referenceX * referenceX + referenceY * referenceY;
  if (denominator < 100) return null;
  const a = (referenceX * targetX + referenceY * targetY) / denominator;
  const b = (referenceX * targetY - referenceY * targetX) / denominator;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale < 0.45 || scale > 2.2) return null;
  return {
    a,
    b,
    tx: first.target.x - a * first.reference.x + b * first.reference.y,
    ty: first.target.y - b * first.reference.x - a * first.reference.y
  };
};

const fitSimilarityLeastSquares = (matches: AlignmentFeatureMatch[]): SimilarityTransform | null => {
  if (matches.length < 2) return null;
  const referenceCenterX = matches.reduce((sum, match) => sum + match.reference.x, 0) / matches.length;
  const referenceCenterY = matches.reduce((sum, match) => sum + match.reference.y, 0) / matches.length;
  const targetCenterX = matches.reduce((sum, match) => sum + match.target.x, 0) / matches.length;
  const targetCenterY = matches.reduce((sum, match) => sum + match.target.y, 0) / matches.length;
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (const match of matches) {
    const referenceX = match.reference.x - referenceCenterX;
    const referenceY = match.reference.y - referenceCenterY;
    const targetX = match.target.x - targetCenterX;
    const targetY = match.target.y - targetCenterY;
    numeratorA += referenceX * targetX + referenceY * targetY;
    numeratorB += referenceX * targetY - referenceY * targetX;
    denominator += referenceX * referenceX + referenceY * referenceY;
  }
  if (denominator < 1e-8) return null;
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  return {
    a,
    b,
    tx: targetCenterX - a * referenceCenterX + b * referenceCenterY,
    ty: targetCenterY - b * referenceCenterX - a * referenceCenterY
  };
};

const scoreTransform = (
  transform: SimilarityTransform,
  matches: AlignmentFeatureMatch[],
  threshold = RANSAC_THRESHOLD
): ScoredTransform => {
  const residuals = matches.map((match) => symmetricResidual(transform, match));
  const inliers = matches.filter((_, index) => residuals[index] <= threshold);
  const inlierResiduals = residuals.filter((residual) => residual <= threshold);
  return {
    transform,
    inliers,
    residuals: inlierResiduals,
    medianResidual: median(inlierResiduals),
    p90Residual: percentile(inlierResiduals, 0.9)
  };
};

const betterScore = (candidate: ScoredTransform, current: ScoredTransform | null) => {
  if (!current) return true;
  if (candidate.inliers.length !== current.inliers.length) {
    return candidate.inliers.length > current.inliers.length;
  }
  if (candidate.medianResidual !== current.medianResidual) {
    return candidate.medianResidual < current.medianResidual;
  }
  return candidate.p90Residual < current.p90Residual;
};

const robustTranslation = (matches: AlignmentFeatureMatch[]) => {
  let score = scoreTransform(fitTranslation(matches), matches);
  for (let iteration = 0; iteration < 2 && score.inliers.length >= 2; iteration += 1) {
    score = scoreTransform(fitTranslation(score.inliers), matches);
  }
  return score;
};

const robustSimilarity = (matches: AlignmentFeatureMatch[]) => {
  const candidates = matches.slice(0, MAX_MATCHES_FOR_RANSAC);
  let best: ScoredTransform | null = null;
  let state = 0x1234abcd;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const iterations = Math.min(
    RANSAC_ITERATIONS,
    Math.max(100, candidates.length * candidates.length)
  );
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const firstIndex = next() % candidates.length;
    let secondIndex = next() % candidates.length;
    if (secondIndex === firstIndex) secondIndex = (secondIndex + 1) % candidates.length;
    const transform = fitSimilarityPair(candidates[firstIndex], candidates[secondIndex]);
    if (!transform) continue;
    const score = scoreTransform(transform, matches);
    if (betterScore(score, best)) best = score;
  }
  if (!best || best.inliers.length < 2) return best;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const refined = fitSimilarityLeastSquares(best.inliers);
    if (!refined) break;
    const score = scoreTransform(refined, matches);
    if (score.inliers.length < best.inliers.length * 0.8) break;
    best = score;
  }
  return best;
};

const coverageEvidence = (
  matches: AlignmentFeatureMatch[],
  width: number,
  height: number
) => {
  const cells = new Set<number>();
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const x = match.reference.x;
    const y = match.reference.y;
    const column = clamp(Math.floor(x / width * 4), 0, 3);
    const row = clamp(Math.floor(y / height * 4), 0, 3);
    cells.add(row * 4 + column);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  const spanX = matches.length ? (maximumX - minimumX) / width : 0;
  const spanY = matches.length ? (maximumY - minimumY) / height : 0;
  return {
    cells: cells.size,
    ratio: cells.size / 16,
    spanX,
    spanY,
    area: spanX * spanY
  };
};

const estimateOverlap = (
  transform: SimilarityTransform,
  reference: AlignmentRaster,
  target: AlignmentRaster
) => {
  let referenceSamples = 0;
  let overlappingSamples = 0;
  const stepX = Math.max(1, Math.floor(reference.width / 40));
  const stepY = Math.max(1, Math.floor(reference.height / 40));
  for (let y = 0; y < reference.height; y += stepY) {
    for (let x = 0; x < reference.width; x += stepX) {
      if (!reference.valid[y * reference.width + x]) continue;
      referenceSamples += 1;
      const mapped = transformPoint(transform, x, y);
      const targetX = Math.round(mapped.x);
      const targetY = Math.round(mapped.y);
      if (
        targetX >= 0 && targetX < target.width
        && targetY >= 0 && targetY < target.height
        && target.valid[targetY * target.width + targetX]
      ) {
        overlappingSamples += 1;
      }
    }
  }
  return referenceSamples ? overlappingSamples / referenceSamples : 0;
};

export const estimateFeatureAlignmentFromMatches = (
  matches: AlignmentFeatureMatch[],
  reference: AlignmentRaster,
  target: AlignmentRaster,
  featureCounts = { reference: 0, target: 0 }
): FeatureAlignmentEstimate => {
  if (matches.length < 8) {
    throw new Error(`Auto Align found only ${matches.length} reliable feature matches; at least 8 are required.`);
  }

  const translation = robustTranslation(matches);
  const similarity = robustSimilarity(matches);
  if (!similarity) throw new Error('Auto Align could not estimate a stable similarity transform.');

  const scale = Math.hypot(similarity.transform.a, similarity.transform.b);
  const rotation = Math.atan2(similarity.transform.b, similarity.transform.a);
  const similarityIsMeaningful = (
    Math.abs(scale - 1) >= 0.0025 || Math.abs(rotation) >= 0.001
  ) && (
    similarity.inliers.length >= translation.inliers.length * 0.9
    && similarity.medianResidual < translation.medianResidual * 0.82
  );
  const selected = similarityIsMeaningful ? similarity : translation;
  const model = similarityIsMeaningful ? 'similarity' : 'translation';
  const refined = model === 'similarity'
    ? fitSimilarityLeastSquares(selected.inliers)
    : fitTranslation(selected.inliers);
  const finalScore = scoreTransform(refined ?? selected.transform, matches);
  const coverage = coverageEvidence(finalScore.inliers, reference.width, reference.height);
  const overlap = estimateOverlap(finalScore.transform, reference, target);
  const identityResiduals = matches.map((match) =>
    Math.hypot(
      match.reference.x - match.target.x,
      match.reference.y - match.target.y
    )
  );
  const finalScale = Math.hypot(finalScore.transform.a, finalScore.transform.b);
  const finalRotation = Math.atan2(finalScore.transform.b, finalScore.transform.a);
  const evidence: FeatureAlignmentEvidence = {
    detectedReferenceFeatures: featureCounts.reference,
    detectedTargetFeatures: featureCounts.target,
    candidateMatches: matches.length,
    mutualMatches: matches.length,
    inlierCount: finalScore.inliers.length,
    inlierRatio: finalScore.inliers.length / matches.length,
    coverageCells: coverage.cells,
    coverageRatio: coverage.ratio,
    overlap,
    medianResidual: finalScore.medianResidual,
    p90Residual: finalScore.p90Residual,
    identityMedianResidual: median(identityResiduals),
    estimatedScale: finalScale,
    estimatedRotationDegrees: finalRotation * 180 / Math.PI,
    model
  };

  const rejectionReasons: string[] = [];
  if (finalScore.inliers.length < 7) rejectionReasons.push('too few geometric inliers');
  if (evidence.inlierRatio < 0.28) rejectionReasons.push('the inlier ratio is too low');
  if (coverage.cells < 3 || coverage.area < 0.025) rejectionReasons.push('matches are too spatially clustered');
  if (overlap < 0.2) rejectionReasons.push('the verified overlap is too small');
  if (finalScore.medianResidual > 2.25 || finalScore.p90Residual > 4) {
    rejectionReasons.push('the geometric residual is too large');
  }
  if (finalScale < 0.5 || finalScale > 2) rejectionReasons.push('the estimated scale is implausible');
  if (Math.abs(finalRotation) > 20 * Math.PI / 180) rejectionReasons.push('the estimated rotation is implausible');
  if (rejectionReasons.length) {
    throw new Error(`Auto Align rejected the result: ${rejectionReasons.join(', ')}.`);
  }

  const inlierScore = clamp((finalScore.inliers.length - 6) / 30, 0, 1);
  const ratioScore = clamp((evidence.inlierRatio - 0.25) / 0.55, 0, 1);
  const coverageScore = clamp((coverage.cells - 2) / 8, 0, 1);
  const residualScore = clamp(1 - finalScore.medianResidual / 2.5, 0, 1);
  const overlapScore = clamp((overlap - 0.2) / 0.65, 0, 1);
  const confidence = clamp(
    0.2 * inlierScore
      + 0.25 * ratioScore
      + 0.2 * coverageScore
      + 0.25 * residualScore
      + 0.1 * overlapScore,
    0,
    1
  );

  return {
    transform: finalScore.transform,
    evidence,
    confidence,
    inlierMatches: finalScore.inliers
  };
};

export const estimateFeatureAlignment = (
  reference: AlignmentRaster,
  target: AlignmentRaster
) => {
  if (reference.width !== target.width || reference.height !== target.height) {
    throw new Error('Auto Align analysis rasters must use the same coordinate space.');
  }
  const referenceFeatures = detectAlignmentFeatures(reference);
  const targetFeatures = detectAlignmentFeatures(target);
  if (referenceFeatures.length < 12 || targetFeatures.length < 12) {
    throw new Error(
      `Auto Align found too little stable detail (${referenceFeatures.length}/${targetFeatures.length} features).`
    );
  }
  const matches = matchAlignmentFeatures(referenceFeatures, targetFeatures);
  return estimateFeatureAlignmentFromMatches(matches, reference, target, {
    reference: referenceFeatures.length,
    target: targetFeatures.length
  });
};
