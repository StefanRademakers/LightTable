import type { DepthAnalysisResult } from './types';

const percentileFromSorted = (sorted: Float32Array, percentile: number) => {
  if (sorted.length === 0) return 0;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * percentile));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
};

export const normalizeRelativeDepth = (
  rawDepth: Float32Array,
  width: number,
  height: number,
  largerIsNear = true
): DepthAnalysisResult => {
  if (rawDepth.length !== width * height || rawDepth.length === 0) {
    throw new Error('Depth estimator returned an invalid map size.');
  }

  // Percentiles do not require sorting every full-resolution value. A regular
  // deterministic sample keeps worker memory bounded while retaining the
  // robust outlier behavior of the requested 1st/99th percentile range.
  const sampleCount = Math.min(rawDepth.length, 250_000);
  const stride = rawDepth.length / sampleCount;
  const sample = new Float32Array(sampleCount);
  let validCount = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = rawDepth[Math.min(rawDepth.length - 1, Math.floor(index * stride))];
    if (Number.isFinite(value)) {
      sample[validCount] = value;
      validCount += 1;
    }
  }
  if (validCount === 0) throw new Error('Depth estimator returned no finite values.');
  const sorted = sample.slice(0, validCount).sort();
  const low = percentileFromSorted(sorted, 0.01);
  const high = percentileFromSorted(sorted, 0.99);
  const range = high - low;
  const normalized = new Float32Array(rawDepth.length);
  if (range <= 1e-8) {
    normalized.fill(0.5);
  } else {
    for (let index = 0; index < rawDepth.length; index += 1) {
      const value = Number.isFinite(rawDepth[index]) ? (rawDepth[index] - low) / range : 0.5;
      const unit = Math.max(0, Math.min(1, value));
      normalized[index] = largerIsNear ? unit : 1 - unit;
    }
  }
  return { width, height, data: normalized, nearIsOne: true };
};

export const sampleMedianDepth = (
  depth: DepthAnalysisResult,
  normalizedX: number,
  normalizedY: number,
  radius = 3
) => {
  const centerX = Math.round(Math.max(0, Math.min(1, normalizedX)) * (depth.width - 1));
  const centerY = Math.round(Math.max(0, Math.min(1, normalizedY)) * (depth.height - 1));
  const values: number[] = [];
  for (let y = Math.max(0, centerY - radius); y <= Math.min(depth.height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(depth.width - 1, centerX + radius); x += 1) {
      const value = depth.data[y * depth.width + x];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
