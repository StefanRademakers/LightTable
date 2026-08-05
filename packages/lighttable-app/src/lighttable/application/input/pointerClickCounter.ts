export interface PointerClickSample {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly button: number;
  readonly pointerType: string;
}

/** PointerEvent.detail is always zero; retain native desktop multi-click semantics explicitly. */
export class PointerClickCounter {
  private previous: PointerClickSample | null = null;
  private count = 0;

  next(sample: PointerClickSample) {
    const previous = this.previous;
    const closeInTime = previous && sample.timeMs >= previous.timeMs
      && sample.timeMs - previous.timeMs <= 500;
    const closeInSpace = previous
      && Math.hypot(sample.x - previous.x, sample.y - previous.y) <= 5;
    const samePointer = previous && sample.button === previous.button
      && sample.pointerType === previous.pointerType;
    this.count = closeInTime && closeInSpace && samePointer
      ? Math.min(5, this.count + 1)
      : 1;
    this.previous = sample;
    return this.count;
  }

  moved(x: number, y: number) {
    if (this.previous && Math.hypot(x - this.previous.x, y - this.previous.y) > 5) this.reset();
  }

  reset() {
    this.previous = null;
    this.count = 0;
  }
}
