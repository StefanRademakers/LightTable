/**
 * Conservative, one-pass edge refinement. Confident foreground/background is
 * preserved; only soft matte pixels borrow from spatially and chromatically
 * similar neighbours. Source alpha is always multiplied into the result.
 */
export const refineBackgroundRemovalMask = (
  predictedAlpha: Uint8Array,
  sourceRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
) => {
  const pixels = width * height;
  if (predictedAlpha.length !== pixels || sourceRgba.length !== pixels * 4) {
    throw new Error('Background-removal output dimensions do not match its source.');
  }
  const result = new Uint8Array(pixels);
  const colorDistance = (a: number, b: number) => {
    const ao = a * 4; const bo = b * 4;
    return Math.abs(sourceRgba[ao]! - sourceRgba[bo]!)
      + Math.abs(sourceRgba[ao + 1]! - sourceRgba[bo + 1]!)
      + Math.abs(sourceRgba[ao + 2]! - sourceRgba[bo + 2]!);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const alpha = predictedAlpha[index]!;
      let refined = alpha;
      if (alpha > 8 && alpha < 247) {
        let total = alpha * 4;
        let weight = 4;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox; const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighbour = ny * width + nx;
            const similarity = Math.max(0, 1 - colorDistance(index, neighbour) / 192);
            if (similarity <= 0) continue;
            total += predictedAlpha[neighbour]! * similarity;
            weight += similarity;
          }
        }
        refined = Math.round(total / weight);
      }
      result[index] = Math.round(refined * (sourceRgba[index * 4 + 3]! / 255));
    }
  }
  return result;
};
