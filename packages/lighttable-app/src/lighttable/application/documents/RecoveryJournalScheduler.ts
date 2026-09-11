export interface RecoveryJournalRevision {
  readonly blocked?: boolean;
  readonly canonicalRevision: number;
  readonly historyStateId: number;
  readonly savedStateId: number;
  readonly dirty: boolean;
}

export interface RecoveryJournalSchedulerOptions {
  readonly debounceMs?: number;
  readonly maxDelayMs?: number;
  readonly checkpoint: (
    revision: RecoveryJournalRevision,
    isCurrent: () => boolean
  ) => Promise<void>;
  readonly onError?: (error: Error) => void;
  readonly maxFailureRetries?: number;
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
  && left!.dirty === right.dirty
  && Boolean(left!.blocked) === Boolean(right.blocked);

/** Expected cancellation before snapshot capture, not an export/storage failure. */
export class RecoveryCheckpointSupersededError extends Error {}

export const recoveryScheduleForSourceBytes = (sourceByteLength = 0) => (
  sourceByteLength >= 32 * 1024 * 1024
    ? { debounceMs: 30_000, maxDelayMs: 120_000 }
    : { debounceMs: 5_000, maxDelayMs: 30_000 }
);

export const recoveryScheduleForPreferences = (
  sourceByteLength = 0,
  intervalMs?: number
) => {
  const adaptive = recoveryScheduleForSourceBytes(sourceByteLength);
  return intervalMs === undefined ? adaptive : {
    debounceMs: Math.min(adaptive.debounceMs, intervalMs),
    maxDelayMs: Math.max(0, intervalMs)
  };
};

/**
 * Bounded newest-source scheduler. It has no polling interval: semantic
 * revisions are the only input capable of creating work.
 */
export class RecoveryJournalScheduler {
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly checkpoint: RecoveryJournalSchedulerOptions['checkpoint'];
  private readonly onError: (error: Error) => void;
  private readonly maxFailureRetries: number;
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
  private failureAttempts = 0;
  private lastError: Error | null = null;
  private readonly idleWaiters = new Set<() => void>();

  constructor({
    debounceMs = 5_000,
    maxDelayMs = 30_000,
    checkpoint,
    onError = () => undefined,
    maxFailureRetries = 2,
    setTimer = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    now = () => Date.now()
  }: RecoveryJournalSchedulerOptions) {
    this.debounceMs = Math.max(0, debounceMs);
    this.maxDelayMs = Math.max(this.debounceMs, maxDelayMs);
    this.checkpoint = checkpoint;
    this.onError = onError;
    this.maxFailureRetries = Math.max(0, Math.floor(maxFailureRetries));
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
  }

  observe(revision: RecoveryJournalRevision): void {
    if (this.disposed || sameRevision(this.latest, revision)) return;
    this.failureAttempts = 0;
    this.lastError = null;
    this.latest = { ...revision };
    if (!revision.dirty || revision.blocked) {
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
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  /** Forces the newest dirty revision through the same single-writer route. */
  async flush(): Promise<void> {
    const maxAttempts = this.maxFailureRetries + 1;
    for (let attempt = 0; attempt < maxAttempts && !this.disposed; attempt += 1) {
      this.cancelTimer();
      if (this.running) {
        await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
      }
      if (!this.latest?.dirty) return;
      if (this.latest.blocked) throw new Error('Finish the active edit before flushing recovery.');
      if (sameRevision(this.written, this.latest)) return;
      if (sameRevision(this.attempted, this.latest)) {
        if (this.lastError) throw this.lastError;
        return;
      }
      await this.run();
      if (this.latest?.dirty && sameRevision(this.written, this.latest)) return;
    }
    this.cancelTimer();
    if (this.lastError && this.latest && sameRevision(this.attempted, this.latest)) {
      throw this.lastError;
    }
    throw new Error('Recovery changed repeatedly during the document transition. Retry the transition.');
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
    if (this.disposed || this.running || !this.latest?.dirty || this.latest.blocked) return;
    const revision = { ...this.latest };
    if (sameRevision(this.attempted, revision)) return;
    this.running = true;
    this.attempted = revision;
    let failed = false;
    const isCurrent = () => !this.disposed
      && Boolean(this.latest?.dirty)
      && sameRevision(this.latest, revision);
    try {
      await this.checkpoint(revision, isCurrent);
      if (isCurrent()) {
        this.written = revision;
        this.failureAttempts = 0;
        this.lastError = null;
      }
    } catch (reason) {
      if (reason instanceof RecoveryCheckpointSupersededError) {
        this.attempted = null;
      } else if (!this.disposed) {
        failed = true;
        this.failureAttempts += 1;
        this.lastError = reason instanceof Error ? reason : new Error(String(reason));
        this.onError(this.lastError);
      }
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
      if (this.disposed) return;
      if (failed && this.failureAttempts <= this.maxFailureRetries
        && sameRevision(this.attempted, this.latest!)) {
        this.attempted = null;
        this.dirtySince = this.now();
        this.schedule();
      } else if (this.latest?.dirty && !this.latest.blocked && !sameRevision(this.attempted, this.latest)) {
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
