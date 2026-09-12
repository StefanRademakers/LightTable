import type { DocumentSession } from '../documents/documentSession';
import type { GpuRecoverySource } from './DocumentGpuRecoveryController';

/** Never substitute a trailing React projection for missing canonical ownership. */
export function resolveGpuRecoverySource(session: DocumentSession | undefined): GpuRecoverySource {
  if (!session) return { kind: 'unavailable' };
  const snapshot = session.getSnapshot();
  if (snapshot.lifecycle === 'closing' || snapshot.lifecycle === 'disposed') return { kind: 'unavailable' };
  if (snapshot.document) return { kind: 'document', document: snapshot.document };
  // Only a session that has not published canonical content can retry its
  // initial source. A missing/cleared ready document is not an empty document.
  const freshOpening = snapshot.lifecycle === 'opening' || snapshot.lifecycle === 'failed';
  const untouched = snapshot.documentRevision === 0 && !snapshot.dirty
    && snapshot.loadedSource.metadata === null && snapshot.loadedSource.blob === null
    && snapshot.loadedSource.fontAssets.length === 0 && snapshot.loadedSource.preservedSources.length === 0
    && snapshot.editor.selectionMaskSnapshot === null && snapshot.editor.selection.length === 0;
  return { kind: freshOpening && untouched ? 'startup' : 'unavailable' };
}
