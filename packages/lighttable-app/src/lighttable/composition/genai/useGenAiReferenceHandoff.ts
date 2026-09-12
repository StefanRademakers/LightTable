import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { GenAiAssetReferenceImportLease } from '../../../genai/application/GenAiAssetReferenceImport';
import type { DocumentSession, DocumentSessionId } from '../../application/documents/documentSession';
import type { LightTableCommandPortRegistry } from '../../application/commands/lightTableCommandPortRegistry';
import { GenAiReferenceHandoff, type GenAiReferenceContext } from '../../application/genai/GenAiReferenceHandoff';
import type { ImageDocument } from '../../editor/document/documentTypes';

export interface GenAiReferenceHandoffBinding {
  readonly context: GenAiReferenceContext;
  readonly workspaceDocuments: readonly { id: string; kind?: string }[];
  readonly status: string;
  readonly commandPorts: Pick<LightTableCommandPortRegistry, 'supportsPort' | 'exportPngArtifact'> | undefined;
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getImageDocument(): ImageDocument | null;
  captureScope(): { isCurrent(): boolean };
  captureImport(isCurrent: () => boolean): GenAiAssetReferenceImportLease;
  activateDocument(documentId: string): void;
  reportError(message: string): void;
}

/** Adapts mounted presentation to reference requests; capture happens at intent/readiness, never initial render. */
export const useGenAiReferenceHandoff = (binding: GenAiReferenceHandoffBinding) => {
  const latest = useRef(binding); latest.current = binding;
  const owner = useMemo(() => new GenAiReferenceHandoff({
    readContext: () => latest.current.context,
    captureImport: current => latest.current.captureImport(current),
    activateDocument: id => latest.current.activateDocument(id),
    reportError: message => latest.current.reportError(message),
    documentState: id => {
      const current = latest.current;
      const target = current.workspaceDocuments.find(item => item.id === id);
      if (!target || target.kind === 'video') return 'missing';
      if (current.context.documentId !== id) return 'pending';
      return current.status === 'failed' ? 'failed' : current.status === 'ready' ? 'ready' : 'pending';
    },
    captureSource: id => {
      const opening = latest.current;
      const session = opening.getSession(); const renderer = opening.getRenderer();
      const snapshot = session?.getSnapshot(); const image = opening.getImageDocument();
      const commands = opening.commandPorts;
      if (!session || !renderer || snapshot?.lifecycle !== 'ready' || !snapshot.document || !image
        || image.id !== snapshot.document.id || opening.context.documentId !== id
        || String(session.id) !== id || opening.status !== 'ready'
        || !commands?.supportsPort(id as DocumentSessionId, 'exportPngArtifact')) return undefined;
      const scope = opening.captureScope();
      const isCurrent = () => {
        const current = latest.current; const state = session.getSnapshot();
        return current.getSession() === session && current.getRenderer() === renderer
          && current.context.documentId === id && state.lifecycle === 'ready'
          && state.documentRevision === snapshot.documentRevision && scope.isCurrent();
      };
      return { isCurrent, exportPng: async () => {
        if (!isCurrent()) throw new DOMException('The reference document was retired.', 'AbortError');
        return commands.exportPngArtifact(id as DocumentSessionId);
      } };
    }
  }), []);
  useLayoutEffect(owner.connect, [owner]);
  // Command port registration is a layout effect. Reference readiness follows it.
  useEffect(owner.synchronize);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  return { ...snapshot, setBaseImageSelected: owner.setBaseImageSelected,
    importReferenceFile: owner.importFile, importDocumentReference: owner.importDocument,
    requestTabReference: owner.requestTabReference };
};
