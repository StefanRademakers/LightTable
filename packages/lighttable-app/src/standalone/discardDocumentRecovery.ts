import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableRecoveryStore } from '../platform/LightTableRecoveryStore';

/**
 * Removes the checkpoint the user explicitly chose to discard.
 *
 * Recovered copies have a fresh session ID, so their original record must be
 * addressed by recovery ID. Ordinary documents remain revision-journaled by
 * their current document ID.
 */
export const discardDocumentRecovery = async (
  store: LightTableRecoveryStore | undefined,
  documentId: DocumentSessionId,
  recoveryId?: string,
  throughRevision?: number
): Promise<void> => {
  if (!store) return;
  if (recoveryId) await store.removeRecord(recoveryId);
  else await store.remove(documentId, throughRevision);
};
