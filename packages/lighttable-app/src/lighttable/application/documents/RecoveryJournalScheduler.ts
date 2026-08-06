export interface RecoveryJournalRevision {
  readonly canonicalRevision: number;
  readonly historyStateId: number;
  readonly savedStateId: number;
  readonly dirty: boolean;
}

export interface RecoveryJournalSchedulerOptions {
  readonly debounceMs?: number;
  readonly maxDelayMs?: number;
  readonly checkpoint: (revision: RecoveryJournalRevision) => Promise<void>;
  readonly onError?: (error: Error) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly now?: () => number;
}

const sameRevision = (
  left: RecoveryJournalRevision | null,
  right: RecoveryJournalRevision
) => Boolean(left)
  && left!.canonicalRevision === right.canonicalRevision
  && left!.historyStateId === right.historyStateId
  && left!.savedStateId === right.savedStateId
  && left!.dirty === right.dirty;

/**
 * Bounded newest-source scheduler. It has no polling interval: semantic
 * revisions are the only input capable of creating work.
 */
export class RecoveryJournalScheduler {
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly checkpoint: (revision: RecoveryJournalRevision) => Promise<void>;
  private readonly onError: (error: Error) => void;
  private readonly setTimer: NonNullable<RecoveryJournalSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<RecoveryJournalSchedulerOptions['clearTimer']>;
  private readonly now: () => number;
  private latest: RecoveryJournalRevision | null = null;
  private written: RecoveryJournalRevision | null = null;
  private attempted: RecoveryJournalRevision | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirtySince: number | null = null;
  private running = false;
  private disposed = false;

  constructor({
    debounceMs = 5_000,
    maxDelayMs = 30_000,
    checkpoint,
    onError = () => undefined,
    setTimer = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    now = () => Date.now()
  }: RecoveryJournalSchedulerOptions) {
    this.debounceMs = Math.max(0, debounceMs);
    this.maxDelayMs = Math.max(this.debounceMs, maxDelayMs);
    this.checkpoint = checkpoint;
    this.onError = onError;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
  }

  observe(revision: RecoveryJournalRevision): void {
    if (this.disposed || sameRevision(this.latest, revision)) return;
    this.latest = { ...revision };
    if (!revision.dirty) {
      this.dirtySince = null;
      this.cancelTimer();
      return;
    }
    this.dirtySince ??= this.now();
    if (!this.running) this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    this.latest = null;
  }

  private schedule(): void {
    this.cancelTimer();
    const elapsed = Math.max(0, this.now() - (this.dirtySince ?? this.now()));
    const delay = Math.min(this.debounceMs, Math.max(0, this.maxDelayMs - elapsed));
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.disposed || this.running || !this.latest?.dirty) return;
    const revision = { ...this.latest };
    if (sameRevision(this.attempted, revision)) return;
    this.running = true;
    this.attempted = revision;
    try {
      await this.checkpoint(revision);
      if (!this.disposed) this.written = revision;
    } catch (reason) {
      if (!this.disposed) {
        this.onError(reason instanceof Error ? reason : new Error(String(reason)));
      }
    } finally {
      this.running = false;
      if (this.disposed) return;
      if (this.latest?.dirty && !sameRevision(this.attempted, this.latest)) {
        this.dirtySince = this.now();
        this.schedule();
      } else {
        this.dirtySince = null;
      }
    }
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
