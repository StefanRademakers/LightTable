import { useEffect, useRef } from 'react';
import type { DocumentCommandHistory } from '../commands/documentCommandHistory';
import type { ExportedLightTableDocument } from './exportLightTableDocument';
import { RecoveryJournalScheduler } from './RecoveryJournalScheduler';
import {
  LIGHTTABLE_RECOVERY_VERSION,
  sha256Hex,
  type LightTableRecoveryRecord,
  type LightTableRecoveryStore
} from '../../../platform/LightTableRecoveryStore';

export interface DocumentRecoveryJournalOptions {
  readonly store?: LightTableRecoveryStore;
  readonly documentId: string;
  readonly sourceFingerprint: string;
  readonly commandHistory: DocumentCommandHistory;
  readonly getCanonicalRevision: () => number;
  readonly exportOutput: () => Promise<ExportedLightTableDocument>;
  readonly onStatus?: (status: 'available' | 'failed', message: string) => void;
}

const createRecoveryId = (): string => typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Connects semantic history changes to recovery without polling clean files. */
export const useDocumentRecoveryJournal = ({
  store,
  documentId,
  sourceFingerprint,
  commandHistory,
  getCanonicalRevision,
  exportOutput,
  onStatus
}: DocumentRecoveryJournalOptions): void => {
  const currentRef = useRef({ getCanonicalRevision, exportOutput, onStatus });
  currentRef.current = { getCanonicalRevision, exportOutput, onStatus };

  useEffect(() => {
    if (!store) return undefined;
    let disposed = false;
    const scheduler = new RecoveryJournalScheduler({
      async checkpoint(revision) {
        const startedAt = performance.now();
        console.info(`[Recovery] Preparing revision ${revision.canonicalRevision}.`);
        const output = await currentRef.current.exportOutput();
        const preparedAt = performance.now();
        console.info(
          `[Recovery] Revision ${revision.canonicalRevision} prepared in `
          + `${(preparedAt - startedAt).toFixed(1)} ms (${Math.round(output.file.size / 1024)} KiB).`
        );
        if (disposed) return;
        const [documentIdHash, sourceFingerprintSha256, artifactChecksumSha256] =
          await Promise.all([
            sha256Hex(documentId),
            sha256Hex(sourceFingerprint),
            sha256Hex(output.file)
          ]);
        if (disposed) return;
        const now = Date.now();
        const record: LightTableRecoveryRecord = {
          version: LIGHTTABLE_RECOVERY_VERSION,
          recoveryId: createRecoveryId(),
          documentIdHash,
          sourceFingerprintSha256,
          canonicalRevision: revision.canonicalRevision,
          historyStateId: revision.historyStateId,
          savedStateId: revision.savedStateId,
          createdAt: now,
          updatedAt: now,
          artifactByteLength: output.file.size,
          artifactChecksumSha256,
          mediaType: output.file.type || 'application/octet-stream'
        };
        const result = await store.write({ documentId, record, artifact: output.file });
        if (disposed) return;
        const finishedAt = performance.now();
        if (result.status === 'failed') {
          currentRef.current.onStatus?.('failed', result.message);
        } else if (result.status === 'committed') {
          console.info(
            `[Recovery] Checkpoint committed: ${Math.round(result.byteLength / 1024)} KiB; `
            + `prepare ${(preparedAt - startedAt).toFixed(1)} ms; `
            + `persist ${(finishedAt - preparedAt).toFixed(1)} ms.`
          );
          currentRef.current.onStatus?.('available', 'Recovery checkpoint available');
        }
      },
      onError(error) {
        currentRef.current.onStatus?.('failed', error.message);
      }
    });

    const observe = (snapshot = commandHistory.getSnapshot()) => scheduler.observe({
      canonicalRevision: Math.max(
        currentRef.current.getCanonicalRevision(),
        snapshot.currentStateId
      ),
      historyStateId: snapshot.currentStateId,
      savedStateId: snapshot.savedStateId,
      dirty: snapshot.dirty
    });
    observe();
    const unsubscribe = commandHistory.subscribe(observe);
    return () => {
      disposed = true;
      unsubscribe();
      scheduler.dispose();
    };
  }, [commandHistory, documentId, sourceFingerprint, store]);
};
