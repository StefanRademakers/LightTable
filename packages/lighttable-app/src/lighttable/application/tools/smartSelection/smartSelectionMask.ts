const isForeground = (logit: number | undefined) => (logit ?? Number.NEGATIVE_INFINITY) > 0;

/**
 * SAM logits express membership, not opacity. Convert them to a binary object
 * decision first, then derive only a one-pixel antialiased boundary from the
 * neighbouring decisions. Model confidence can therefore never make a whole
 * selected object translucent.
 */
export const selectionMaskFromLogits = (
  logits: ArrayLike<number>,
  offset: number,
  width: number,
  height: number,
  hardEdge: boolean
) => {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const foreground = isForeground(logits[offset + index]);
      if (hardEdge) {
        output[index] = foreground ? 255 : 0;
        continue;
      }

      let neighbourWeight = 0;
      let totalWeight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= width) continue;
          const weight = dx === 0 && dy === 0 ? 4 : 1;
          totalWeight += weight;
          if (isForeground(logits[offset + sampleY * width + sampleX])) {
            neighbourWeight += weight;
          }
        }
      }
      output[index] = Math.round((neighbourWeight / totalWeight) * 255);
    }
  }
  return output;
};
