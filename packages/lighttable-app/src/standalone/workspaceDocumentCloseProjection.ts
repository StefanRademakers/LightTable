import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';

/** Selects the same adjacent document for workspace projection and recovery ownership. */
export const nextActiveDocumentAfterClose = (
  order: readonly DocumentSessionId[],
  activeId: DocumentSessionId | null,
  closingId: DocumentSessionId
): DocumentSessionId | null => {
  if (activeId !== closingId) return activeId;
  const index = order.indexOf(closingId);
  const remaining = order.filter((candidate) => candidate !== closingId);
  return remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null;
};
