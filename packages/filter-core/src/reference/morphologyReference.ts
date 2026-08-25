export type MorphologyReferenceMode = 'maximum' | 'minimum';
export type MorphologyReferenceShape = 'round' | 'square';

/** Slow deterministic oracle; production code must never call this path. */
export const morphologyReferenceRgba = (
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  mode: MorphologyReferenceMode,
  shape: MorphologyReferenceShape
): Float32Array => {
  if (width < 1 || height < 1 || source.length !== width * height * 4) {
    throw new RangeError('Morphology reference input dimensions are invalid.');
  }
  const support = Math.max(1, Math.round(radius));
  const result = new Float32Array(source.length);
  const rank = mode === 'maximum' ? Math.max : Math.min;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      result.set(source.subarray(target, target + 4), target);
      for (let dy = -support; dy <= support; dy += 1) {
        for (let dx = -support; dx <= support; dx += 1) {
          if (shape === 'round' && dx * dx + dy * dy > support * support) continue;
          const sampleX = Math.max(0, Math.min(width - 1, x + dx));
          const sampleY = Math.max(0, Math.min(height - 1, y + dy));
          const sample = (sampleY * width + sampleX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            result[target + channel] = rank(result[target + channel]!, source[sample + channel]!);
          }
        }
      }
    }
  }
  return result;
};
