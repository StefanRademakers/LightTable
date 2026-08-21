export const DOCUMENT_PALETTE_SAMPLE_TARGET = 65_536;
export const DOCUMENT_PALETTE_ALPHA_THRESHOLD = 13;
export const DOCUMENT_PALETTE_MAX_COLORS = 256;

export interface PaletteColor {
  readonly rgb: readonly [number, number, number];
  readonly hex: string;
  readonly coverage: number;
  readonly pixelCount: number;
  readonly oklab: readonly [number, number, number];
}

export interface DocumentPaletteSamples {
  /** Exact, non-interpolated display-sRGB samples from the final composite. */
  readonly pixels: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

interface HistogramEntry {
  readonly packed: number;
  readonly rgb: readonly [number, number, number];
  readonly lab: readonly [number, number, number];
  readonly count: number;
}

interface PaletteHistogram {
  readonly entries: readonly HistogramEntry[];
  readonly acceptedSamples: number;
}

interface ClusterResult {
  readonly centroid: readonly [number, number, number];
  readonly weight: number;
  readonly candidates: readonly HistogramEntry[];
}

const clampColorCount = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > DOCUMENT_PALETTE_MAX_COLORS) {
    throw new Error(`Palette colorCount must be an integer from 1 to ${DOCUMENT_PALETTE_MAX_COLORS}.`);
  }
  return value;
};

const linearSrgb = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** Standard OKLab conversion for deterministic perceptual clustering. */
export const rgb8ToOklab = (rgb: readonly [number, number, number]): readonly [number, number, number] => {
  const r = linearSrgb(rgb[0]);
  const g = linearSrgb(rgb[1]);
  const b = linearSrgb(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
};

const distanceSquared = (left: readonly number[], right: readonly number[]) => {
  const dl = left[0] - right[0];
  const da = left[1] - right[1];
  const db = left[2] - right[2];
  return dl * dl + da * da + db * db;
};

export const buildDocumentPaletteHistogram = (
  pixels: Uint8Array | Uint8ClampedArray,
  alphaThreshold = DOCUMENT_PALETTE_ALPHA_THRESHOLD
): PaletteHistogram => {
  if (pixels.byteLength % 4 !== 0) throw new Error('Palette pixels must contain packed RGBA8 data.');
  const counts = new Map<number, number>();
  let acceptedSamples = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < alphaThreshold) continue;
    const packed = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
    counts.set(packed, (counts.get(packed) ?? 0) + 1);
    acceptedSamples += 1;
  }
  const entries = [...counts].map(([packed, count]) => {
    const rgb = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255] as const;
    return { packed, rgb, count, lab: rgb8ToOklab(rgb) };
  }).sort((left, right) => right.count - left.count || left.packed - right.packed);
  return { entries, acceptedSamples };
};

const initializeCentroids = (entries: readonly HistogramEntry[], count: number) => {
  const centroids: Array<readonly [number, number, number]> = [entries[0].lab];
  const selected = new Set([entries[0].packed]);
  while (centroids.length < count) {
    let best: HistogramEntry | null = null;
    let bestScore = -1;
    for (const entry of entries) {
      if (selected.has(entry.packed)) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) nearest = Math.min(nearest, distanceSquared(entry.lab, centroid));
      const score = entry.count * nearest;
      if (score > bestScore || (score === bestScore && entry.packed < (best?.packed ?? Number.MAX_SAFE_INTEGER))) {
        best = entry;
        bestScore = score;
      }
    }
    if (!best) break;
    selected.add(best.packed);
    centroids.push(best.lab);
  }
  return centroids;
};

const clusterHistogram = (histogram: PaletteHistogram, requestedCount: number): readonly ClusterResult[] => {
  const count = Math.min(requestedCount, histogram.entries.length);
  if (count === 0) return [];
  let centroids = initializeCentroids(histogram.entries, count);
  let assignments = new Int32Array(histogram.entries.length).fill(-1);
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const sums = Array.from({ length: count }, () => [0, 0, 0, 0]);
    let assignmentChanged = false;
    for (let entryIndex = 0; entryIndex < histogram.entries.length; entryIndex += 1) {
      const entry = histogram.entries[entryIndex];
      let cluster = 0;
      let nearest = distanceSquared(entry.lab, centroids[0]);
      for (let index = 1; index < count; index += 1) {
        const distance = distanceSquared(entry.lab, centroids[index]);
        if (distance < nearest) { nearest = distance; cluster = index; }
      }
      if (assignments[entryIndex] !== cluster) assignmentChanged = true;
      assignments[entryIndex] = cluster;
      const sum = sums[cluster];
      sum[0] += entry.lab[0] * entry.count;
      sum[1] += entry.lab[1] * entry.count;
      sum[2] += entry.lab[2] * entry.count;
      sum[3] += entry.count;
    }
    let movement = 0;
    centroids = centroids.map((centroid, index) => {
      const sum = sums[index];
      if (sum[3] === 0) return centroid;
      const next = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] as const;
      movement = Math.max(movement, distanceSquared(centroid, next));
      return next;
    });
    if (!assignmentChanged || movement < 1e-12) break;
  }
  const candidates = Array.from({ length: count }, () => [] as HistogramEntry[]);
  const weights = new Array<number>(count).fill(0);
  histogram.entries.forEach((entry, index) => {
    const cluster = assignments[index];
    candidates[cluster].push(entry);
    weights[cluster] += entry.count;
  });
  return centroids.map((centroid, index) => ({
    centroid,
    weight: weights[index],
    candidates: candidates[index].sort((left, right) => right.count - left.count
      || distanceSquared(left.lab, centroid) - distanceSquared(right.lab, centroid)
      || left.packed - right.packed)
  })).filter(({ weight }) => weight > 0)
    .sort((left, right) => right.weight - left.weight
      || (left.candidates[0]?.packed ?? 0) - (right.candidates[0]?.packed ?? 0));
};

const DUPLICATE_DISTANCE_SQUARED = 0.025 ** 2;

export const extractDocumentPalette = (histogram: PaletteHistogram, colorCount: number): readonly PaletteColor[] => {
  const requested = clampColorCount(colorCount);
  if (histogram.acceptedSamples === 0) return [];
  const clusters = clusterHistogram(histogram, requested);
  const selected: Array<{ cluster: ClusterResult; entry: HistogramEntry }> = [];
  for (const cluster of clusters) {
    const entry = cluster.candidates.find((candidate) => selected.every(
      (current) => distanceSquared(candidate.lab, current.entry.lab) >= DUPLICATE_DISTANCE_SQUARED
    ));
    if (entry) selected.push({ cluster, entry });
  }
  return selected.map(({ cluster, entry }) => ({
    rgb: entry.rgb,
    hex: `#${entry.packed.toString(16).padStart(6, '0')}`.toUpperCase(),
    coverage: cluster.weight / histogram.acceptedSamples,
    pixelCount: entry.count,
    oklab: entry.lab
  }));
};

/**
 * Per-document lazy cache. A revision change invalidates both sampled histogram
 * and K-specific clustering without doing any work until the next request.
 */
export class DocumentPaletteExtractor {
  private revision: number | null = null;
  private histogram: PaletteHistogram | null = null;
  private readonly results = new Map<number, readonly PaletteColor[]>();
  private inFlight: Promise<PaletteHistogram> | null = null;

  constructor(private readonly sample: () => Promise<DocumentPaletteSamples>) {}

  async getPalette(revision: number, colorCount: number): Promise<readonly PaletteColor[]> {
    const count = clampColorCount(colorCount);
    if (this.revision !== revision) {
      this.revision = revision;
      this.histogram = null;
      this.inFlight = null;
      this.results.clear();
    }
    const cached = this.results.get(count);
    if (cached) return cached;
    this.inFlight ??= this.sample()
      .then(({ pixels }) => buildDocumentPaletteHistogram(pixels))
      .catch((reason) => {
        if (this.revision === revision) this.inFlight = null;
        throw reason;
      });
    const histogram = this.histogram ?? await this.inFlight;
    if (this.revision !== revision) throw new Error('The document changed while its palette was sampled.');
    this.histogram = histogram;
    const result = extractDocumentPalette(histogram, count);
    this.results.set(count, result);
    return result;
  }

  clear(): void {
    this.revision = null;
    this.histogram = null;
    this.inFlight = null;
    this.results.clear();
  }
}
