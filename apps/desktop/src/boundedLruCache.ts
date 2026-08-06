export class BoundedLruCache<T> {
  private readonly values = new Map<string, T>();

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('LRU cache limit must be positive.');
  }

  get size(): number { return this.values.size; }

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value;
      if (typeof oldest !== 'string') return;
      this.values.delete(oldest);
    }
  }

  delete(key: string): void { this.values.delete(key); }
}
