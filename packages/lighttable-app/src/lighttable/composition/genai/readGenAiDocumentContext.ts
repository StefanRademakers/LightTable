import type { GenAiDocumentContext } from '../../../genai/application/genAiDocumentDefaults';
import type { DocumentSession } from '../../application/documents/documentSession';

/** Request-time provenance reads canonical state, not a React inspector/defaults projection. */
export const readGenAiDocumentContext = (session: DocumentSession | null | undefined): GenAiDocumentContext | undefined => {
  const snapshot = session?.getSnapshot();
  const document = snapshot?.document;
  if (!session || !document || snapshot.lifecycle !== 'ready') return undefined;
  return { id: session.id, revision: snapshot.documentRevision, width: document.width, height: document.height };
};
