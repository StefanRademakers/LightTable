export interface ParagraphFragmentCacheMetrics {
  readonly entries: number;
  readonly byteLength: number;
  readonly budgetBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

interface ParagraphFragmentCacheEntry<T> {
  readonly value: T;
  readonly byteLength: number;
  touched: number;
}

/** Worker-local, byte-bounded LRU for immutable paragraph-shaping fragments. */
export class ParagraphFragmentCache<T> {
  private readonly entries = new Map<string, ParagraphFragmentCacheEntry<T>>();
  private clock = 0;
  private byteLength = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly estimateBytes: (value: T) => number,
    private readonly budgetBytes = 16 * 1024 * 1024
  ) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) {
      throw new RangeError('Paragraph fragment cache budget must be a non-negative safe integer.');
    }
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    entry.touched = ++this.clock;
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T): T {
    const estimated = this.estimateBytes(value);
    if (!Number.isSafeInteger(estimated) || estimated < 0) {
      throw new RangeError('Paragraph fragment size must be a non-negative safe integer.');
    }
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.byteLength -= previous.byteLength;
    }
    if (estimated > this.budgetBytes) return value;
    this.entries.set(key, { value, byteLength: estimated, touched: ++this.clock });
    this.byteLength += estimated;
    while (this.byteLength > this.budgetBytes) this.evictOldest();
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.byteLength = 0;
  }

  metrics(): ParagraphFragmentCacheMetrics {
    return Object.freeze({
      entries: this.entries.size,
      byteLength: this.byteLength,
      budgetBytes: this.budgetBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    });
  }

  private evictOldest(): void {
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
