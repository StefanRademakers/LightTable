export const LIGHTTABLE_DOCUMENT_DRAG_TYPE = 'application/x-lighttable-document-id';

export const writeLightTableDocumentDrag = (transfer: DataTransfer, documentId: string, title: string): void => {
  transfer.effectAllowed = 'copy';
  transfer.setData(LIGHTTABLE_DOCUMENT_DRAG_TYPE, documentId);
  transfer.setData('text/plain', title);
};

export const readLightTableDocumentDrag = (transfer: DataTransfer): string | undefined => {
  const documentId = transfer.getData(LIGHTTABLE_DOCUMENT_DRAG_TYPE).trim();
  return documentId || undefined;
};

export const containsLightTableDocumentDrag = (transfer: DataTransfer): boolean =>
  Array.from(transfer.types).includes(LIGHTTABLE_DOCUMENT_DRAG_TYPE);
