import type { DocumentCommandHistory } from '../commands/documentCommandHistory';
import type { ExportedLightTableDocument } from './exportLightTableDocument';
import { useDocumentRecoveryJournal } from './useDocumentRecoveryJournal';
import type { LightTableRecoveryStore } from '../../../platform/LightTableRecoveryStore';

export interface EditorRecoveryJournalOptions {
  readonly store?: LightTableRecoveryStore;
  readonly documentId: string;
  readonly sourceKey: string | null;
  readonly sourceName: string;
  readonly sourceBlob: Blob | null;
  readonly workspaceOrder: number;
  readonly active: boolean;
  readonly commandHistory: DocumentCommandHistory;
  readonly getCanonicalRevision: () => number;
  readonly exportOutput: (options?: { readonly lightweightPreview?: boolean }) => Promise<ExportedLightTableDocument>;
  readonly setStatus: (message: string) => void;
}

export const useEditorRecoveryJournal = ({
  store, documentId, sourceKey, sourceName, sourceBlob, workspaceOrder, active,
  commandHistory, getCanonicalRevision, exportOutput, setStatus
}: EditorRecoveryJournalOptions): void => useDocumentRecoveryJournal({
  store,
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
  exportOutput,
  onStatus: (status, message) => {
    if (status === 'failed') console.warn(`[Recovery] ${message}`);
    setStatus(status === 'failed' ? 'Recovery checkpoint unavailable' : message);
  }
});
