import type { LightTableSaveResult } from '../../../platform/LightTableHost';
import { deliverDocumentTaskExport } from './documentExportDelivery';

export interface DocumentFileDeliverySource {
  readonly taskRegistry: { readonly isDisposed: boolean };
  readonly commandHistory: object;
  getDocument(): { readonly id: string } | null;
  getRenderer(): object | null;
  getRendererGeneration?(): number;
  onExportFile?(file: File): Promise<LightTableSaveResult> | LightTableSaveResult;
  setError(error: string | null): void;
  setStatus?(status: string | null): void;
}

/** Host callbacks and terminal UI belong to the initiating session/mount, not the latest render. */
export const captureDocumentFileDelivery = (
  resolve: () => DocumentFileDeliverySource,
  getMountGeneration: () => number,
  download: (file: File) => void
) => {
  const opening = resolve();
  const documentId = opening.getDocument()?.id;
  const renderer = opening.getRenderer();
  const rendererGeneration = opening.getRendererGeneration?.() ?? 0;
  const mountGeneration = getMountGeneration();
  const isCurrent = () => {
    const current = resolve();
    return Boolean(documentId && renderer && !opening.taskRegistry.isDisposed
      && current.taskRegistry === opening.taskRegistry
      && current.commandHistory === opening.commandHistory && current.getDocument()?.id === documentId
      && current.getRenderer() === renderer && (current.getRendererGeneration?.() ?? 0) === rendererGeneration
      && getMountGeneration() === mountGeneration);
  };
  return {
    isCurrent,
    error: (message: string | null) => { if (isCurrent()) opening.setError(message); },
    status: (message: string | null) => { if (isCurrent()) opening.setStatus?.(message); },
    deliver: async (file: File) => {
      if (!isCurrent()) throw new DOMException('The file delivery target was retired.', 'AbortError');
      await deliverDocumentTaskExport(file, opening.onExportFile, download);
    }
  };
};
