export type MatteRefinementQuality = 'fast' | 'standard' | 'high';

export interface MatteRefinementOptions {
  readonly enabled: boolean;
  readonly quality: MatteRefinementQuality;
}

export interface MatteRefinementImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}

export interface MatteRefinementRoi {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TrimapResult {
  readonly data: Uint8Array;
  readonly roi: MatteRefinementRoi;
  readonly foregroundRadiusPx: number;
  readonly backgroundRadiusPx: number;
}

const QUALITY = {
  fast: { foregroundRadius: 1, backgroundRadius: 3, filterRadius: 2, iterations: 1, colorSigma: 42 },
  standard: { foregroundRadius: 3, backgroundRadius: 8, filterRadius: 4, iterations: 2, colorSigma: 30 },
  high: { foregroundRadius: 5, backgroundRadius: 14, filterRadius: 6, iterations: 3, colorSigma: 22 }
} as const;

const foregroundAt = (logits: ArrayLike<number>, offset: number, index: number) =>
  (logits[offset + index] ?? Number.NEGATIVE_INFINITY) > 0;

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const findForegroundBounds = (
  logits: ArrayLike<number>, offset: number, width: number, height: number
): MatteRefinementRoi | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!foregroundAt(logits, offset, y * width + x)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const dilate = (source: Uint8Array, width: number, height: number, radius: number) => {
  let current = source;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (current[index]) continue;
      if ((x > 0 && current[index - 1]) || (x + 1 < width && current[index + 1])
        || (y > 0 && current[index - width]) || (y + 1 < height && current[index + width])) next[index] = 1;
    }
    current = next;
  }
  return current;
};

const erode = (source: Uint8Array, width: number, height: number, radius: number) => {
  let current = source;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!current[index]) continue;
      if (x === 0 || x + 1 === width || y === 0 || y + 1 === height
        || !current[index - 1] || !current[index + 1]
        || !current[index - width] || !current[index + width]) next[index] = 0;
    }
    current = next;
  }
  return current;
};

export const buildAdaptiveTrimap = (
  logits: ArrayLike<number>, offset: number, width: number, height: number,
  quality: MatteRefinementQuality
): TrimapResult => {
  const config = QUALITY[quality];
  const bounds = findForegroundBounds(logits, offset, width, height);
  if (!bounds) return {
    data: new Uint8Array(width * height), roi: { x: 0, y: 0, width: 0, height: 0 },
    foregroundRadiusPx: config.foregroundRadius, backgroundRadiusPx: config.backgroundRadius
  };
  const padding = Math.max(config.backgroundRadius + 2, Math.ceil(Math.max(bounds.width, bounds.height) * 0.08));
  const roi = {
    x: Math.max(0, bounds.x - padding), y: Math.max(0, bounds.y - padding),
    width: 0, height: 0
  };
  const right = Math.min(width, bounds.x + bounds.width + padding);
  const bottom = Math.min(height, bounds.y + bounds.height + padding);
  roi.width = right - roi.x;
  roi.height = bottom - roi.y;
  const binary = new Uint8Array(roi.width * roi.height);
  for (let y = 0; y < roi.height; y += 1) for (let x = 0; x < roi.width; x += 1) {
    binary[y * roi.width + x] = foregroundAt(logits, offset, (roi.y + y) * width + roi.x + x) ? 1 : 0;
  }
  const certainForeground = erode(binary, roi.width, roi.height, config.foregroundRadius);
  const possibleForeground = dilate(binary, roi.width, roi.height, config.backgroundRadius);
  const trimap = new Uint8Array(roi.width * roi.height);
  for (let index = 0; index < trimap.length; index += 1) {
    trimap[index] = certainForeground[index] ? 255 : possibleForeground[index] ? 128 : 0;
  }
  return { data: trimap, roi, foregroundRadiusPx: config.foregroundRadius,
    backgroundRadiusPx: config.backgroundRadius };
};

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

/**
 * Refines only the trimap's unknown band. Certain foreground/background remain
 * exact, so SAM confidence can never turn an object's interior translucent.
 * The filter is RGB-guided rather than a mask blur: pixels propagate alpha
 * primarily between neighbours with similar source colour.
 */
export const refineMatteFromLogits = (
  logits: ArrayLike<number>, offset: number, width: number, height: number,
  image: MatteRefinementImage, quality: MatteRefinementQuality
) => {
  const trimap = buildAdaptiveTrimap(logits, offset, width, height, quality);
  const output = new Uint8Array(width * height);
  for (let index = 0; index < output.length; index += 1) output[index] = foregroundAt(logits, offset, index) ? 255 : 0;
  if (trimap.roi.width === 0 || image.width !== width || image.height !== height) return output;
  const { roi } = trimap;
  const config = QUALITY[quality];
  const pixels = roi.width * roi.height;
  let alpha = new Float32Array(pixels);
  for (let y = 0; y < roi.height; y += 1) for (let x = 0; x < roi.width; x += 1) {
    const local = y * roi.width + x;
    const source = (roi.y + y) * width + roi.x + x;
    alpha[local] = trimap.data[local] === 255 ? 1 : trimap.data[local] === 0 ? 0
      : sigmoid((logits[offset + source] ?? 0) * 1.35);
  }
  const sigma2 = 2 * config.colorSigma * config.colorSigma;
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const next = alpha.slice();
    for (let y = 0; y < roi.height; y += 1) for (let x = 0; x < roi.width; x += 1) {
      const local = y * roi.width + x;
      if (trimap.data[local] !== 128) continue;
      const sourcePixel = ((roi.y + y) * width + roi.x + x) * image.channels;
      let total = 0;
      let weighted = 0;
      for (let dy = -config.filterRadius; dy <= config.filterRadius; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= roi.height) continue;
        for (let dx = -config.filterRadius; dx <= config.filterRadius; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= roi.width) continue;
          const samplePixel = ((roi.y + sy) * width + roi.x + sx) * image.channels;
          const dr = (image.data[sourcePixel] ?? 0) - (image.data[samplePixel] ?? 0);
          const dg = (image.data[sourcePixel + 1] ?? image.data[sourcePixel] ?? 0)
            - (image.data[samplePixel + 1] ?? image.data[samplePixel] ?? 0);
          const db = (image.data[sourcePixel + 2] ?? image.data[sourcePixel] ?? 0)
            - (image.data[samplePixel + 2] ?? image.data[samplePixel] ?? 0);
          const spatial = 1 / (1 + dx * dx + dy * dy);
          const weight = spatial * Math.exp(-(dr * dr + dg * dg + db * db) / sigma2);
          total += weight;
          weighted += weight * alpha[sy * roi.width + sx];
        }
      }
      if (total > 0) next[local] = weighted / total;
    }
    alpha = next;
  }
  for (let y = 0; y < roi.height; y += 1) for (let x = 0; x < roi.width; x += 1) {
    const local = y * roi.width + x;
    output[(roi.y + y) * width + roi.x + x] = trimap.data[local] === 255 ? 255
      : trimap.data[local] === 0 ? 0 : clampByte(alpha[local] * 255);
  }
  return output;
};
