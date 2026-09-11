import type { DocumentRendererStatus } from '../../application/rendering/documentRendererLifecycle';

export interface DocumentPresentationAvailabilityInput {
  readonly documentId: string;
  readonly presentedDocumentId: string | null;
  readonly residentDocumentId: string | null;
  readonly rendererStatus: DocumentRendererStatus;
}

export interface DocumentPresentationAvailability {
  readonly ready: boolean;
  readonly resident: boolean;
  readonly available: boolean;
}

/**
 * Projects renderer ownership into one presentation decision for every UI
 * consumer. A resident swap-chain frame survives blur, but never renderer
 * failure, disposal, generation replacement or document replacement.
 */
export const documentPresentationAvailability = ({
  documentId,
  presentedDocumentId,
  residentDocumentId,
  rendererStatus
}: DocumentPresentationAvailabilityInput): DocumentPresentationAvailability => {
  const resident = residentDocumentId === documentId
    && (rendererStatus === 'ready' || rendererStatus === 'suspended');
  // A presented frame is usable only while the same ownership epoch also
  // retains it. This makes ready => resident structural instead of relying on
  // two React publications landing in the same render.
  const ready = resident && presentedDocumentId === documentId && rendererStatus === 'ready';
  return { ready, resident, available: ready || resident };
};
