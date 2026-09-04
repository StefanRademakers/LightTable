export type EditorOperationTransactionPhase =
  | 'open'
  | 'rolling-back'
  | 'rolled-back'
  | 'committed'
  | 'failed';

export interface EditorOperationTransactionEvent {
  readonly operation: string;
  readonly phase: EditorOperationTransactionPhase;
  readonly step?: string;
  readonly reason?: unknown;
}

export interface EditorOperationTransactionOptions {
  readonly operation: string;
  readonly onEvent?: (event: EditorOperationTransactionEvent) => void;
}

interface AppliedStep {
  readonly label: string;
  readonly rollback: () => void;
}

/**
 * Synchronous all-or-none boundary for editor operations that cross owners.
 *
 * A rollback is registered before its corresponding mutation runs. This is
 * intentional: a dependency is allowed to throw after making a partial
 * change, and that partial change must still be compensated. Successful
 * callers explicitly commit; every other exit rolls applied steps back in
 * reverse order.
 */
export class EditorOperationTransaction {
  private phase: EditorOperationTransactionPhase = 'open';
  private readonly appliedSteps: AppliedStep[] = [];

  constructor(private readonly options: EditorOperationTransactionOptions) {
    this.emit('open');
  }

  get currentPhase(): EditorOperationTransactionPhase {
    return this.phase;
  }

  /** Registers compensation for a mutation that already completed. */
  adopt(label: string, rollback: () => void): void {
    this.assertOpen();
    this.appliedSteps.push({ label, rollback });
    this.emit('open', label);
  }

  /** Runs a mutation with its compensation installed before execution. */
  step<Result>(label: string, apply: () => Result, rollback: () => void): Result {
    this.adopt(label, rollback);
    return apply();
  }

  commit(): void {
    this.assertOpen();
    this.appliedSteps.length = 0;
    this.phase = 'committed';
    this.emit('committed');
  }

  rollback(reason?: unknown): void {
    if (this.phase !== 'open') return;
    this.phase = 'rolling-back';
    this.emit('rolling-back', undefined, reason);
    const failures: unknown[] = [];
    for (const step of [...this.appliedSteps].reverse()) {
      try {
        step.rollback();
      } catch (rollbackReason) {
        failures.push(new Error(
          `Rollback step "${step.label}" failed.`,
          { cause: rollbackReason }
        ));
      }
    }
    this.appliedSteps.length = 0;
    if (failures.length) {
      this.phase = 'failed';
      const failure = new AggregateError(
        failures,
        `${this.options.operation} rollback did not complete.`,
        { cause: reason }
      );
      this.emit('failed', undefined, failure);
      throw failure;
    }
    this.phase = 'rolled-back';
    this.emit('rolled-back', undefined, reason);
  }

  private assertOpen(): void {
    if (this.phase !== 'open') {
      throw new Error(
        `${this.options.operation} transaction is ${this.phase}, not open.`
      );
    }
  }

  private emit(
    phase: EditorOperationTransactionPhase,
    step?: string,
    reason?: unknown
  ): void {
    try {
      this.options.onEvent?.({
        operation: this.options.operation,
        phase,
        step,
        reason
      });
    } catch (observerReason) {
      // Diagnostics are observers, never part of the operation's correctness.
      console.error('LightTable operation diagnostics failed.', observerReason);
    }
  }
}

export const runEditorOperationTransaction = <Result>(
  options: EditorOperationTransactionOptions,
  operation: (transaction: EditorOperationTransaction) => Result
): Result => {
  const transaction = new EditorOperationTransaction(options);
  try {
    const result = operation(transaction);
    transaction.commit();
    return result;
  } catch (reason) {
    try {
      transaction.rollback(reason);
    } catch (rollbackReason) {
      throw rollbackReason;
    }
    throw reason;
  }
};
