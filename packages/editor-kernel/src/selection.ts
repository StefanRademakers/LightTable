import type {
  DocumentAddress,
  DocumentSessionId,
  SelectionRevision,
  TransactionId,
  TransactionRevision,
} from './identities';

export interface DocumentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The one committed selection value consumed by overlays, paint, clipboard and history.
 * Provenance can describe how the mask was authored, but it is never coverage authority.
 */
export interface CommittedSelectionState<Coverage = unknown, Provenance = unknown> {
  readonly documentSessionId: DocumentSessionId;
  readonly revision: SelectionRevision;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly active: boolean;
  readonly coverage: Coverage;
  readonly supportBounds: DocumentRect | null;
  readonly provenance: readonly Provenance[];
}

/** A stable selection revision captured by a pixel consumer at transaction start. */
export interface SelectionReadLease<Coverage = unknown, Provenance = unknown> {
  readonly document: DocumentAddress;
  readonly selection: CommittedSelectionState<Coverage, Provenance>;
}

export interface SelectionPreview<Payload = unknown> {
  readonly transactionId: TransactionId;
  readonly revision: TransactionRevision;
  readonly payload: Payload;
}

export interface PreparedSelectionProjection<Coverage = unknown, Provenance = unknown> {
  readonly transactionId: TransactionId;
  readonly baselineRevision: SelectionRevision;
  readonly result: CommittedSelectionState<Coverage, Provenance>;
  /** Atomically swaps the prepared renderer targets into presentation. */
  activate(): SelectionProjectionActivation;
  dispose(): void;
}

export interface SelectionProjectionActivation {
  /** Keeps the activated projection after canonical state and history accept it. */
  accept(): void;
  /** Restores the exact prior projection when publication is rejected. */
  rollback(): void;
}

export interface SelectionProjectionPort<Intent = unknown, Coverage = unknown, Provenance = unknown> {
  prepare(
    document: DocumentAddress,
    baseline: CommittedSelectionState<Coverage, Provenance>,
    intent: Intent,
    transactionId: TransactionId,
    signal: AbortSignal,
  ): Promise<PreparedSelectionProjection<Coverage, Provenance>>;
  presentPreview(preview: SelectionPreview): void;
  clearPreview(transactionId: TransactionId): void;
}

export interface SelectionStateStore<Coverage = unknown, Provenance = unknown> {
  read(documentSessionId: DocumentSessionId): CommittedSelectionState<Coverage, Provenance>;
  compareAndSwap(
    expectedRevision: SelectionRevision,
    next: CommittedSelectionState<Coverage, Provenance>,
  ): boolean;
}

export interface SelectionHistoryChange<Coverage = unknown, Provenance = unknown> {
  readonly transactionId: TransactionId;
  readonly before: CommittedSelectionState<Coverage, Provenance>;
  readonly after: CommittedSelectionState<Coverage, Provenance>;
}

export interface SelectionHistoryReservation {
  commit(): boolean;
  cancel(): void;
}

export interface SelectionHistoryAdmission<Coverage = unknown, Provenance = unknown> {
  reserve(change: SelectionHistoryChange<Coverage, Provenance>): SelectionHistoryReservation;
}

export interface SelectionPublicationBoundary {
  run<Result>(operation: () => Result): Result;
}

export type SelectionCommitResult<Coverage = unknown, Provenance = unknown> =
  | { readonly ok: true; readonly selection: CommittedSelectionState<Coverage, Provenance> }
  | { readonly ok: false; readonly reason: 'cancelled' | 'conflict' | 'prepare-failed';
      readonly message: string };

/** Owns the only admissible prepare -> activate -> state/history publish sequence. */
export class SelectionMutationCoordinator<Intent = unknown, Coverage = unknown, Provenance = unknown> {
  constructor(private readonly dependencies: {
    readonly state: SelectionStateStore<Coverage, Provenance>;
    readonly projection: SelectionProjectionPort<Intent, Coverage, Provenance>;
    readonly history: SelectionHistoryAdmission<Coverage, Provenance>;
    readonly publication: SelectionPublicationBoundary;
  }) {}

  async execute(input: {
    readonly target: DocumentAddress;
    readonly intent: Intent;
    readonly transactionId: TransactionId;
    readonly signal: AbortSignal;
  }): Promise<SelectionCommitResult<Coverage, Provenance>> {
    if (input.signal.aborted) return {
      ok: false, reason: 'cancelled', message: 'The selection transaction was cancelled.',
    };
    let baseline: CommittedSelectionState<Coverage, Provenance>;
    try {
      baseline = this.dependencies.state.read(input.target.sessionId);
      assertCommittedSelectionState(baseline);
    } catch (reason) {
      return { ok: false, reason: 'prepare-failed',
        message: reason instanceof Error ? reason.message : 'The selection baseline is invalid.' };
    }
    let prepared: PreparedSelectionProjection<Coverage, Provenance> | null = null;
    let reservation: SelectionHistoryReservation | null = null;
    let activation: SelectionProjectionActivation | null = null;
    let statePublished = false;
    try {
      prepared = await this.dependencies.projection.prepare(
        input.target, baseline, input.intent, input.transactionId, input.signal,
      );
      assertCommittedSelectionState(prepared.result);
      if (Number(prepared.result.revision) !== Number(baseline.revision) + 1) {
        throw new Error('A selection commit must advance its revision exactly once.');
      }
      if (input.signal.aborted) throw new DOMException('Selection cancelled.', 'AbortError');
      reservation = this.dependencies.history.reserve({
        transactionId: input.transactionId, before: baseline, after: prepared.result,
      });
      activation = prepared.activate();
      const committed = this.dependencies.publication.run(() => {
        statePublished = this.dependencies.state.compareAndSwap(
          prepared!.baselineRevision, prepared!.result,
        );
        if (!statePublished) return false;
        if (reservation!.commit()) return true;
        this.dependencies.state.compareAndSwap(prepared!.result.revision, baseline);
        statePublished = false;
        throw new Error('Reserved selection history admission was invalidated.');
      });
      if (!committed) {
        activation.rollback();
        reservation.cancel();
        return { ok: false, reason: 'conflict', message: 'The selection changed concurrently.' };
      }
      activation.accept();
      return { ok: true, selection: prepared.result };
    } catch (reason) {
      if (activation) {
        try { activation.rollback(); } catch { /* retain original failure */ }
      } else {
        prepared?.dispose();
      }
      reservation?.cancel();
      if (statePublished && prepared) {
        this.dependencies.publication.run(() => {
          this.dependencies.state.compareAndSwap(prepared!.result.revision, baseline);
        });
      }
      const cancelled = input.signal.aborted
        || (reason instanceof DOMException && reason.name === 'AbortError');
      return { ok: false, reason: cancelled ? 'cancelled' : 'prepare-failed',
        message: reason instanceof Error ? reason.message : 'The selection could not be committed.' };
    }
  }
}

const finite = (value: number) => Number.isFinite(value);

export function assertCommittedSelectionState(
  state: CommittedSelectionState,
): void {
  if (!Number.isSafeInteger(state.canvas.width) || state.canvas.width < 1
    || !Number.isSafeInteger(state.canvas.height) || state.canvas.height < 1) {
    throw new RangeError('Selection canvas dimensions must be positive safe integers');
  }
  if (!state.active) {
    if (state.supportBounds !== null) {
      throw new Error('An inactive selection cannot have support bounds');
    }
    if (state.provenance.length !== 0) {
      throw new Error('An inactive selection cannot retain semantic provenance');
    }
    return;
  }
  const bounds = state.supportBounds;
  if (!bounds || !finite(bounds.x) || !finite(bounds.y)
    || !finite(bounds.width) || !finite(bounds.height)
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('An active selection requires finite, non-empty support bounds');
  }
  if (bounds.x < 0 || bounds.y < 0
    || bounds.x + bounds.width > state.canvas.width
    || bounds.y + bounds.height > state.canvas.height) {
    throw new RangeError('Selection support bounds must describe effective in-canvas coverage');
  }
}
