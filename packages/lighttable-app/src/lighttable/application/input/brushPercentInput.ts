export class BrushPercentInput {
  private pending: { target: 'opacity' | 'flow'; digit: number; at: number } | null = null;

  constructor(private readonly timeoutMs = 500) {}

  input(target: 'opacity' | 'flow', digit: number, now = performance.now()): number {
    const previous = this.pending;
    if (previous && previous.target === target && now - previous.at <= this.timeoutMs) {
      this.pending = null;
      return previous.digit * 10 + digit;
    }
    this.pending = { target, digit, at: now };
    return digit === 0 ? 100 : digit * 10;
  }

  clear(): void { this.pending = null; }
}
