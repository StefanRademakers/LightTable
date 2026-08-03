import type { RealizedTextLayout } from '@lighttable/text-core';

interface Entry {
  readonly layout: RealizedTextLayout;
  readonly byteLength: number;
  touched: number;
}

export interface TextLayoutCacheMetrics {
  readonly entries: number;
  readonly byteLength: number;
  readonly budgetBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

export const estimateTextLayoutBytes = (layout: RealizedTextLayout) => {
  let bytes = 256 + layout.key.length * 2;
  for (const run of layout.glyphRuns) {
    bytes += 192 + run.glyphIds.byteLength + run.clusters.byteLength + run.geometry.byteLength;
    if (run.transforms) bytes += run.transforms.byteLength;
  }
  bytes += (layout.lines?.length ?? 0) * 64;
  bytes += (layout.caretStops?.length ?? 0) * 48;
  bytes += (layout.selectionGeometry?.length ?? 0) * 48;
  bytes += (layout.clusterMap?.length ?? 0) * 40;
  bytes += (layout.warnings ?? []).reduce(
    (sum, warning) => sum + 48 + warning.message.length * 2,
    0
  );
  return bytes;
};

/** Byte-bounded LRU for immutable realized layouts owned by one document session. */
export class TextLayoutCache {
  private readonly entries = new Map<string, Entry>();
  private clock = 0;
  private byteLength = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly budgetBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) {
      throw new RangeError('Text layout cache budget must be a non-negative safe integer.');
    }
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    entry.touched = ++this.clock;
    this.hits += 1;
    return entry.layout;
  }

  set(key: string, layout: RealizedTextLayout) {
    const byteLength = estimateTextLayoutBytes(layout);
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.byteLength -= previous.byteLength;
    }
    if (byteLength > this.budgetBytes) return layout;
    this.entries.set(key, { layout, byteLength, touched: ++this.clock });
    this.byteLength += byteLength;
    while (this.byteLength > this.budgetBytes) this.evictOldest();
    return layout;
  }

  clear() {
    this.entries.clear();
    this.byteLength = 0;
  }

  metrics(): TextLayoutCacheMetrics {
    return Object.freeze({
      entries: this.entries.size,
      byteLength: this.byteLength,
      budgetBytes: this.budgetBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    });
  }

  private evictOldest() {
    let oldestKey: string | null = null;
    let oldestTouch = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.touched < oldestTouch) {
        oldestKey = key;
        oldestTouch = entry.touched;
      }
    }
    if (oldestKey === null) return;
    const entry = this.entries.get(oldestKey)!;
    this.entries.delete(oldestKey);
    this.byteLength -= entry.byteLength;
    this.evictions += 1;
  }
}
