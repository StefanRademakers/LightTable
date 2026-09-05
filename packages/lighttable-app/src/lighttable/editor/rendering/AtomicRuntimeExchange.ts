export type RuntimeResourceState = 'before' | 'after';

export interface AtomicRuntimeExchange {
  readonly label: string;
  readonly before: unknown;
  readonly after: unknown;
  current: RuntimeResourceState;
  exchange(replacement: unknown): unknown;
  equals(left: unknown, right: unknown): boolean;
}

export const createAtomicRuntimeExchange = <T>(input: {
  readonly label: string;
  readonly before: T;
  readonly after: T;
  exchange(replacement: T): T;
  equals?(left: T, right: T): boolean;
}): AtomicRuntimeExchange => ({
  label: input.label,
  before: input.before,
  after: input.after,
  current: 'before',
  exchange: (replacement) => input.exchange(replacement as T),
  equals: (left, right) => input.equals
    ? input.equals(left as T, right as T)
    : left === right
});

const swapExpected = (
  exchange: AtomicRuntimeExchange,
  replacement: unknown,
  expectedCurrent: unknown
) => {
  const displaced = exchange.exchange(replacement);
  if (exchange.equals(displaced, expectedCurrent)) return;
  const restoreFailures: unknown[] = [];
  try {
    const restoreDisplaced = exchange.exchange(displaced);
    if (!exchange.equals(restoreDisplaced, replacement)) {
      restoreFailures.push(new Error(`${exchange.label} changed again while it was being restored.`));
    }
  } catch (reason) {
    restoreFailures.push(reason);
  }
  const mismatch = new Error(`${exchange.label} changed outside the owned runtime transaction.`);
  if (restoreFailures.length) {
    throw new AggregateError([mismatch, ...restoreFailures], `${exchange.label} could not be restored.`);
  }
  throw mismatch;
};

/**
 * Moves a heterogeneous group of live runtime resources as one state change.
 * A failed or stale exchange is restored immediately; earlier exchanges are
 * compensated in reverse order before the error leaves this boundary.
 */
export const applyAtomicRuntimeState = (
  exchanges: readonly AtomicRuntimeExchange[],
  state: RuntimeResourceState
) => {
  const changed: AtomicRuntimeExchange[] = [];
  try {
    for (const exchange of exchanges) {
      if (exchange.current === state) continue;
      const previous = exchange.current === 'before' ? exchange.before : exchange.after;
      const replacement = state === 'before' ? exchange.before : exchange.after;
      swapExpected(exchange, replacement, previous);
      changed.push(exchange);
    }
  } catch (reason) {
    const rollbackFailures: unknown[] = [];
    for (const exchange of changed.reverse()) {
      const previous = exchange.current === 'before' ? exchange.before : exchange.after;
      const replacement = state === 'before' ? exchange.before : exchange.after;
      try {
        swapExpected(exchange, previous, replacement);
      } catch (rollbackReason) {
        rollbackFailures.push(rollbackReason);
      }
    }
    if (rollbackFailures.length) {
      throw new AggregateError(
        [reason, ...rollbackFailures],
        `Runtime transition to ${state} failed and did not fully roll back.`
      );
    }
    throw reason;
  }
  changed.forEach((exchange) => { exchange.current = state; });
};
