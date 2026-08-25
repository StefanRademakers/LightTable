export interface ReferenceImage {
  readonly width: number;
  readonly height: number;
  /** Premultiplied linear RGBA. */
  readonly data: Float32Array;
}

const sample = (image: ReferenceImage, x: number, y: number, channel: number): number => {
  const clampedX = Math.min(image.width - 1, Math.max(0, x));
  const clampedY = Math.min(image.height - 1, Math.max(0, y));
  return image.data[(clampedY * image.width + clampedX) * 4 + channel] ?? 0;
};

/** Deliberately simple FP32 oracle; production renderers must not call this path. */
export const gaussianReference = (image: ReferenceImage, radius: number): ReferenceImage => {
  const support = Math.max(0, Math.ceil(radius));
  if (support === 0) return { ...image, data: image.data.slice() };
  const sigma = Math.max(radius / 3, 0.5);
  const weights = Array.from({ length: support + 1 }, (_, tap) =>
    Math.exp(-(tap * tap) / (2 * sigma * sigma)));
  const total = weights[0]! + 2 * weights.slice(1).reduce((sum, value) => sum + value, 0);
  const horizontal = new Float32Array(image.data.length);
  const output = new Float32Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        let value = sample(image, x, y, channel) * weights[0]!;
        for (let tap = 1; tap <= support; tap += 1) {
          value += (sample(image, x - tap, y, channel) + sample(image, x + tap, y, channel))
            * weights[tap]!;
        }
        horizontal[(y * image.width + x) * 4 + channel] = value / total;
      }
    }
  }
  const intermediate = { width: image.width, height: image.height, data: horizontal };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        let value = sample(intermediate, x, y, channel) * weights[0]!;
        for (let tap = 1; tap <= support; tap += 1) {
          value += (sample(intermediate, x, y - tap, channel) + sample(intermediate, x, y + tap, channel))
            * weights[tap]!;
        }
        output[(y * image.width + x) * 4 + channel] = value / total;
      }
    }
  }
  return { width: image.width, height: image.height, data: output };
};
