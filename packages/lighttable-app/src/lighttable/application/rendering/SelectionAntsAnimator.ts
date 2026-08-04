interface SelectionAntsAnimatorPorts {
  invalidateViewport(): void;
  requestRender(): void;
}

interface SelectionAntsAnimatorOptions {
  intervalMs?: number;
  schedule?: typeof globalThis.setTimeout;
  cancel?: typeof globalThis.clearTimeout;
}

/**
 * Advances only the presentation phase of a committed selection contour.
 *
 * Geometry and mask resources remain untouched. Inactive documents and
 * documents without a visible committed selection own no running timer.
 */
export class SelectionAntsAnimator {
  private readonly intervalMs: number;
  private readonly schedule: typeof globalThis.setTimeout;
  private readonly cancel: typeof globalThis.clearTimeout;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private active = true;
  private selectionVisible = false;
  private phase = 0;
  private disposed = false;

  constructor(
    private readonly ports: SelectionAntsAnimatorPorts,
    options: SelectionAntsAnimatorOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 500;
    this.schedule = options.schedule ?? globalThis.setTimeout.bind(globalThis);
    this.cancel = options.cancel ?? globalThis.clearTimeout.bind(globalThis);
  }

  get phasePx() {
    return this.phase;
  }

  setActive(active: boolean) {
    if (this.disposed || active === this.active) return;
    this.active = active;
    this.syncTimer();
  }

  setSelectionVisible(visible: boolean) {
    if (this.disposed || visible === this.selectionVisible) return;
    this.selectionVisible = visible;
    if (!visible) this.phase = 0;
    this.syncTimer();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer();
  }

  private syncTimer() {
    if (this.active && this.selectionVisible) this.startTimer();
    else this.stopTimer();
  }

  private startTimer() {
    if (this.timer !== null || this.disposed) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (this.disposed || !this.active || !this.selectionVisible) return;
      // 72 px is the least common cycle of the 8 px black/white contour and
      // the 9 px vector dash pattern. Four pixels swaps black and white.
      this.phase = (this.phase + 4) % 72;
      this.ports.invalidateViewport();
      this.ports.requestRender();
      this.startTimer();
    }, this.intervalMs);
  }

  private stopTimer() {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }
}
