export interface DisposableResource {
  dispose(): void;
}

interface CacheEntry<T> {
  value: T;
  bytes: number;
  touched: number;
}

export interface ResourceCacheMetrics {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

/** Weighted LRU for derived CPU data or explicitly disposable backend data. */
export class RevisionedResourceCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private clock = 0;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly dispose?: (value: T) => void
  ) {
    if (!(maxBytes >= 0) || !Number.isFinite(maxBytes)) {
      throw new RangeError('Cache budget must be a finite non-negative byte count.');
    }
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    entry.touched = ++this.clock;
    return entry.value;
  }

  set(key: string, value: T, bytes: number) {
    if (!(bytes >= 0) || !Number.isFinite(bytes)) {
      throw new RangeError('Cached resource size must be finite and non-negative.');
    }
    this.delete(key);
    this.entries.set(key, { value, bytes, touched: ++this.clock });
    this.bytes += bytes;
    this.trim();
    return value;
  }

  getOrCreate(key: string, bytes: number, create: () => T) {
    const existing = this.get(key);
    return existing ?? this.set(key, create(), bytes);
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    this.dispose?.(entry.value);
    return true;
  }

  deleteWhere(predicate: (key: string, value: T) => boolean) {
    let deleted = 0;
    for (const [key, entry] of [...this.entries]) {
      if (predicate(key, entry.value) && this.delete(key)) deleted += 1;
    }
    return deleted;
  }

  clear() {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }

  metrics(): ResourceCacheMetrics {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions
    };
  }

  private trim() {
    while (this.bytes > this.maxBytes && this.entries.size > 0) {
      let oldestKey: string | null = null;
      let oldestTouch = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.touched < oldestTouch) {
          oldestTouch = entry.touched;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      this.evictions += 1;
      this.delete(oldestKey);
    }
  }
}

export const disposableResourceCache = <T extends DisposableResource>(maxBytes: number) =>
  new RevisionedResourceCache<T>(maxBytes, (value) => value.dispose());
