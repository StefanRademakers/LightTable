import { useEffect, useRef } from 'react';
import type { DocumentCommandHistory } from '../commands/documentCommandHistory';
import type { ExportedLightTableDocument } from './exportLightTableDocument';
import { RecoveryJournalScheduler, recoveryScheduleForSourceBytes } from './RecoveryJournalScheduler';
import {
  LIGHTTABLE_RECOVERY_VERSION,
  sha256Hex,
  type LightTableRecoveryRecord,
  type LightTableRecoveryStore
} from '../../../platform/LightTableRecoveryStore';
import { RecoveryArtifactHasher } from './RecoveryArtifactHasher';

export interface DocumentRecoveryJournalOptions {
  readonly store?: LightTableRecoveryStore;
  readonly documentId: string;
  readonly sourceFingerprint: string;
  readonly sourceName: string;
  readonly sourceMediaType: string;
  readonly sourceByteLength?: number;
  readonly sourcePath?: string;
  readonly sourceLastModified?: number;
  readonly workspaceOrder: number;
  readonly wasActive: boolean;
  readonly commandHistory: DocumentCommandHistory;
  readonly getCanonicalRevision: () => number;
  readonly exportOutput: (options?: { readonly lightweightPreview?: boolean }) => Promise<ExportedLightTableDocument>;
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
  sourceName,
  sourceMediaType,
  sourceByteLength,
  sourcePath,
  sourceLastModified,
  workspaceOrder,
  wasActive,
  commandHistory,
  getCanonicalRevision,
  exportOutput,
  onStatus
}: DocumentRecoveryJournalOptions): void => {
  const currentRef = useRef({
    getCanonicalRevision,
    exportOutput,
    onStatus,
    sourceName,
    sourceMediaType,
    sourcePath,
    sourceLastModified,
    workspaceOrder,
    wasActive
  });
  currentRef.current = {
    getCanonicalRevision,
    exportOutput,
    onStatus,
    sourceName,
    sourceMediaType,
    sourcePath,
    sourceLastModified,
    workspaceOrder,
    wasActive
  };

  useEffect(() => {
    if (!store) return undefined;
    let disposed = false;
    const artifactHasher = new RecoveryArtifactHasher();
    const timing = recoveryScheduleForSourceBytes(sourceByteLength);
    const scheduler = new RecoveryJournalScheduler({
      ...timing,
      async checkpoint(revision) {
        const startedAt = performance.now();
        console.info(`[Recovery] Preparing revision ${revision.canonicalRevision}.`);
        const output = await currentRef.current.exportOutput({ lightweightPreview: true });
        const preparedAt = performance.now();
        console.info(
          `[Recovery] Revision ${revision.canonicalRevision} prepared in `
          + `${(preparedAt - startedAt).toFixed(1)} ms (${Math.round(output.file.size / 1024)} KiB).`
        );
        if (disposed) return;
        const [documentIdHash, sourceFingerprintSha256, preparedArtifact] =
          await Promise.all([
            sha256Hex(documentId),
            sha256Hex(sourceFingerprint),
            artifactHasher.prepare(output.file)
          ]);
        if (disposed) return;
        const now = Date.now();
        const record: LightTableRecoveryRecord = {
          version: LIGHTTABLE_RECOVERY_VERSION,
          recoveryId: createRecoveryId(),
          documentIdHash,
          sourceFingerprintSha256,
          sourceName: currentRef.current.sourceName,
          sourceMediaType: currentRef.current.sourceMediaType,
          ...(currentRef.current.sourcePath
            ? { sourcePath: currentRef.current.sourcePath }
            : {}),
          ...(currentRef.current.sourceLastModified !== undefined
            ? { sourceLastModified: currentRef.current.sourceLastModified }
            : {}),
          workspaceOrder: currentRef.current.workspaceOrder,
          wasActive: currentRef.current.wasActive,
          canonicalRevision: revision.canonicalRevision,
          historyStateId: revision.historyStateId,
          savedStateId: revision.savedStateId,
          createdAt: now,
          updatedAt: now,
          artifactByteLength: output.file.size,
          artifactChecksumSha256: preparedArtifact.checksumSha256,
          mediaType: output.file.type || 'application/octet-stream'
        };
        const result = await store.write({ documentId, record, artifact: output.file,
          ...(preparedArtifact.bytes ? { preparedBytes: preparedArtifact.bytes } : {}) });
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
      artifactHasher.dispose();
    };
  }, [commandHistory, documentId, sourceByteLength, sourceFingerprint, store]);
};
