import type { DocumentCommandHistory } from '../commands/documentCommandHistory';
import type { ExportedLightTableDocument } from './exportLightTableDocument';
import { useDocumentRecoveryJournal } from './useDocumentRecoveryJournal';
import type { LightTableRecoveryStore } from '../../../platform/LightTableRecoveryStore';
import type { DocumentSession } from './documentSession';
import type { DocumentRecoveryJournalHandle } from './useDocumentRecoveryJournal';

export interface EditorRecoveryJournalOptions {
  readonly canCaptureSnapshot: () => boolean;
  readonly store?: LightTableRecoveryStore;
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly documentId: string;
  readonly sourceKey: string | null;
  readonly sourceName: string;
  readonly sourceBlob: Blob | null;
  readonly workspaceOrder: number;
  readonly active: boolean;
  readonly commandHistory: DocumentCommandHistory;
  readonly documentSession?: DocumentSession;
  readonly getCanonicalRevision: () => number;
  readonly exportOutput: (options?: { readonly lightweightPreview?: boolean }) => Promise<ExportedLightTableDocument>;
  readonly setStatus: (message: string) => void;
}

export const useEditorRecoveryJournal = ({
  store, enabled, intervalMs, documentId, sourceKey, sourceName, sourceBlob, workspaceOrder, active,
  commandHistory, documentSession, getCanonicalRevision, exportOutput, setStatus, canCaptureSnapshot
}: EditorRecoveryJournalOptions): DocumentRecoveryJournalHandle => useDocumentRecoveryJournal({
  store,
  canCaptureSnapshot,
  enabled,
  intervalMs,
  documentId,
  sourceFingerprint: `${sourceKey ?? 'unknown'}:${sourceName}`,
  sourceName,
  sourceMediaType: sourceBlob?.type || 'application/octet-stream',
  sourceByteLength: sourceBlob?.size,
  sourcePath: sourceBlob instanceof File
    ? (sourceBlob as File & { readonly lightTableSourcePath?: string }).lightTableSourcePath
    : undefined,
  sourceLastModified: sourceBlob instanceof File ? sourceBlob.lastModified : undefined,
  workspaceOrder,
  wasActive: active,
  commandHistory,
  getCanonicalRevision,
  subscribe: documentSession?.subscribe,
  getRevision: documentSession ? () => {
    const snapshot = documentSession.getSnapshot();
    return {
      canonicalRevision: snapshot.documentRevision,
      historyStateId: snapshot.history.currentStateId,
      savedStateId: snapshot.history.savedStateId,
      dirty: snapshot.dirty
    };
  } : undefined,
  exportOutput,
  onStatus: (status, message) => {
    if (status === 'failed') console.warn(`[Recovery] ${message}`);
    setStatus(status === 'failed' ? 'Recovery checkpoint unavailable' : message);
  }
});
