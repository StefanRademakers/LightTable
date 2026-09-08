export type PixelMutationDirection = 'undo' | 'redo';

export interface ReversiblePixelMutationStep {
  readonly byteSize: number;
  apply(direction: PixelMutationDirection): boolean;
  dispose(): void;
}

export interface AppliedPixelMutation<State> {
  readonly operation: string;
  readonly before: State;
  /** State required before undo can address a target removed by the commit. */
  readonly undoBase?: State;
  /** State required before redo can address a target created by the commit. */
  readonly redoBase?: State;
  readonly after: State;
  readonly steps: readonly ReversiblePixelMutationStep[];
  /** Retained runtime resources not represented by a reversible edit. */
  readonly retainedByteSize?: number;
}

export interface PixelMutationHistoryRecord {
  readonly byteSize: number;
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface PixelMutationPublicationPort<State, History extends PixelMutationHistoryRecord> {
  applyState(state: State): void;
  appendHistory(entry: History): void;
}

const opposite = (direction: PixelMutationDirection): PixelMutationDirection =>
  direction === 'undo' ? 'redo' : 'undo';

const disposeSteps = (steps: readonly ReversiblePixelMutationStep[]) => {
  for (const step of steps) step.dispose();
};

/**
 * Owns publication and replay ordering for an already-applied GPU mutation.
 * Domain adapters supply pixels and canonical state; this coordinator owns
 * compensation, history transfer, target preparation, and disposal order.
 */
export class AppliedPixelMutationCoordinator<State> {
  constructor(private readonly resolvePort: () => PixelMutationPublicationPort<
    State, PixelMutationHistoryRecord
  >) {}

  commit<History extends PixelMutationHistoryRecord>(
    mutation: AppliedPixelMutation<State>,
    createHistory: (lifecycle: PixelMutationHistoryRecord) => History,
  ): History {
    if (mutation.steps.length === 0) {
      throw new Error(`${mutation.operation} has no reversible pixel edit.`);
    }
    const lifecycle: PixelMutationHistoryRecord = {
      byteSize: mutation.steps.reduce((total, step) => total + step.byteSize, 0)
        + Math.max(0, mutation.retainedByteSize ?? 0),
      undo: () => this.replay(mutation, 'undo'),
      redo: () => this.replay(mutation, 'redo'),
      dispose: () => disposeSteps(mutation.steps),
    };
    const history = createHistory(lifecycle);
    const port = this.resolvePort();
    try {
      port.applyState(mutation.after);
      port.appendHistory(history);
      return history;
    } catch (reason) {
      const ordered = [...mutation.steps].reverse();
      const applied: ReversiblePixelMutationStep[] = [];
      try {
        // The published `after` snapshot may have removed the GPU target that
        // an undo step must address. Recreate that target before touching the
        // pixels, and publish the canonical `before` state only after every
        // reverse edit succeeded.
        const rollbackBase = mutation.undoBase ?? mutation.redoBase;
        if (rollbackBase !== undefined) port.applyState(rollbackBase);
        for (const step of ordered) {
          if (!step.apply('undo')) {
            throw new Error(`${mutation.operation} commit rollback is no longer available.`);
          }
          applied.push(step);
        }
        port.applyState(mutation.before);
      } catch (rollbackReason) {
        // Restore the forward GPU state when rollback only got part-way. The
        // snapshots remain deliberately undisposed: destroying the sole
        // recovery payload would turn a surfaced commit error into data loss.
        for (const step of [...applied].reverse()) {
          if (!step.apply('redo')) {
            throw new AggregateError(
              [reason, rollbackReason],
              `${mutation.operation} commit and GPU rollback both failed.`
            );
          }
        }
        port.applyState(mutation.after);
        throw new AggregateError(
          [reason, rollbackReason],
          `${mutation.operation} commit failed and was restored to its applied state.`
        );
      }
      disposeSteps(mutation.steps);
      throw reason;
    }
  }

  private replay(
    mutation: AppliedPixelMutation<State>,
    direction: PixelMutationDirection,
  ): void {
    const port = this.resolvePort();
    const target = direction === 'undo' ? mutation.before : mutation.after;
    const source = direction === 'undo' ? mutation.after : mutation.before;
    const base = direction === 'undo' ? mutation.undoBase : mutation.redoBase;
    const ordered = direction === 'undo' ? [...mutation.steps].reverse() : [...mutation.steps];
    const applied: ReversiblePixelMutationStep[] = [];
    let targetPublicationStarted = false;
    if (base !== undefined) port.applyState(base);
    try {
      for (const step of ordered) {
        if (!step.apply(direction)) {
          throw new Error(`${mutation.operation} ${direction} is no longer available.`);
        }
        applied.push(step);
      }
      targetPublicationStarted = true;
      port.applyState(target);
    } catch (reason) {
      for (const step of [...applied].reverse()) {
        if (!step.apply(opposite(direction))) {
          throw new Error(`${mutation.operation} ${direction} GPU compensation failed.`, {
            cause: reason,
          });
        }
      }
      if (base !== undefined || targetPublicationStarted) port.applyState(source);
      throw reason;
    }
  }
}
