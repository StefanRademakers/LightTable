import type { DocumentSaveTransactionOutcome } from './documentSaveTransaction';

/**
 * A committed host write pins one exact revision even when newer edits keep the
 * document dirty. Recovery through that pinned revision is therefore stale.
 */
export const cleanupRecoveryAfterSave = async (
  outcome: DocumentSaveTransactionOutcome,
  cleanup?: (savedRevision: number) => Promise<void> | void
): Promise<Error | null> => {
  if (outcome.status !== 'committed' || !cleanup) return null;
  try {
    await cleanup(outcome.revision);
    return null;
  } catch (reason) {
    return reason instanceof Error ? reason : new Error(String(reason));
  }
};
