import type { DocumentAddress, TransactionId, TransactionRevision } from './identities';

export type TransactionPhase =
  | 'open'
  | 'previewing'
  | 'committing'
  | 'committed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export interface EditTransactionState<Baseline = unknown> {
  readonly id: TransactionId;
  readonly document: DocumentAddress;
  readonly phase: TransactionPhase;
  readonly baseline: Baseline;
  readonly previewRevision: TransactionRevision;
  readonly failure?: string;
}

export type TransactionEvent =
  | { readonly type: 'preview'; readonly revision: TransactionRevision }
  | { readonly type: 'begin-commit' }
  | { readonly type: 'commit-succeeded' }
  | { readonly type: 'begin-cancel' }
  | { readonly type: 'cancel-succeeded' }
  | { readonly type: 'fail'; readonly reason: string };

const transitions: Readonly<Record<TransactionPhase, ReadonlySet<TransactionEvent['type']>>> = {
  open: new Set(['preview', 'begin-commit', 'begin-cancel', 'fail']),
  previewing: new Set(['preview', 'begin-commit', 'begin-cancel', 'fail']),
  committing: new Set(['commit-succeeded', 'fail']),
  committed: new Set(),
  cancelling: new Set(['cancel-succeeded', 'fail']),
  cancelled: new Set(),
  failed: new Set(),
};

export function advanceTransaction<Baseline>(
  state: EditTransactionState<Baseline>,
  event: TransactionEvent,
): EditTransactionState<Baseline> {
  if (!transitions[state.phase].has(event.type)) {
    throw new Error(`Invalid transaction transition: ${state.phase} -> ${event.type}`);
  }

  switch (event.type) {
    case 'preview':
      if (event.revision <= state.previewRevision) {
        throw new Error('Preview revisions must increase monotonically');
      }
      return { ...state, phase: 'previewing', previewRevision: event.revision };
    case 'begin-commit':
      return { ...state, phase: 'committing' };
    case 'commit-succeeded':
      return { ...state, phase: 'committed' };
    case 'begin-cancel':
      return { ...state, phase: 'cancelling' };
    case 'cancel-succeeded':
      return { ...state, phase: 'cancelled' };
    case 'fail':
      return { ...state, phase: 'failed', failure: event.reason };
  }
}
