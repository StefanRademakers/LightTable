import type { LightTableSaveResult } from '../../../platform/LightTableHost';

export type DocumentExportDeliveryStatus = 'committed' | 'canceled' | 'unreported';

/**
 * Owns the terminal host result for every exported artifact. Hosts may cancel
 * normally, but a resolved failure must not be mistaken for successful I/O.
 * Unknown results remain compatible with embedded consumers that only signal
 * completion through promise resolution.
 */
export const deliverDocumentExport = async (
  file: File,
  deliver: ((file: File) => Promise<LightTableSaveResult> | LightTableSaveResult) | undefined,
  fallback: (file: File) => void,
): Promise<DocumentExportDeliveryStatus> => {
  if (!deliver) {
    fallback(file);
    return 'unreported';
  }
  const result = await deliver(file);
  if (result.status === 'failed') {
    throw new Error(
      `Export failed during ${result.phase || 'write'}: ${result.message || 'Unknown error'}`
    );
  }
  return result.status;
};

/** Maps a user-canceled host picker onto the task registry's normal cancel path. */
export const deliverDocumentTaskExport = async (
  file: File,
  deliver: ((file: File) => Promise<LightTableSaveResult> | LightTableSaveResult) | undefined,
  fallback: (file: File) => void,
): Promise<void> => {
  const status = await deliverDocumentExport(file, deliver, fallback);
  if (status === 'canceled') throw new DOMException('Export canceled.', 'AbortError');
};
