import { describe, expect, it } from 'vitest';
import type { DocumentAddress, TransactionId, TransactionRevision } from './identities';
import { advanceTransaction, type EditTransactionState } from './transactions';

const transaction = (): EditTransactionState<{ readonly source: 'stable' }> => ({
  id: 'tx-1' as TransactionId,
  document: { sessionId: 'document-1', revision: 7 } as DocumentAddress,
  phase: 'open',
  baseline: { source: 'stable' },
  previewRevision: 0 as TransactionRevision,
});

describe('advanceTransaction', () => {
  it('keeps one baseline through repeated preview updates and commit', () => {
    const first = advanceTransaction(transaction(), {
      type: 'preview',
      revision: 1 as TransactionRevision,
    });
    const second = advanceTransaction(first, {
      type: 'preview',
      revision: 2 as TransactionRevision,
    });
    const committing = advanceTransaction(second, { type: 'begin-commit' });
    const committed = advanceTransaction(committing, { type: 'commit-succeeded' });

    expect(committed.phase).toBe('committed');
    expect(committed.baseline).toBe(first.baseline);
    expect(committed.previewRevision).toBe(2);
  });

  it('rejects stale previews and transitions after a terminal state', () => {
    const previewing = advanceTransaction(transaction(), {
      type: 'preview',
      revision: 2 as TransactionRevision,
    });
    expect(() => advanceTransaction(previewing, {
      type: 'preview',
      revision: 1 as TransactionRevision,
    })).toThrow('Preview revisions must increase monotonically');

    const cancelling = advanceTransaction(previewing, { type: 'begin-cancel' });
    const cancelled = advanceTransaction(cancelling, { type: 'cancel-succeeded' });
    expect(() => advanceTransaction(cancelled, { type: 'begin-commit' }))
      .toThrow('Invalid transaction transition');
  });
});
