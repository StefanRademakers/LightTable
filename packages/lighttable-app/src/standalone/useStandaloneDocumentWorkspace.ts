import {
  useCallback,
  useMemo,
  useSyncExternalStore
} from 'react';
import {
  type DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import {
  DocumentWorkspaceController
} from '../lighttable/application/workspace/documentWorkspaceController';
import {
  projectStandaloneDocumentWorkspace
} from './projectStandaloneDocumentWorkspace';
import {
  standaloneSourceIdentity,
  type StandaloneDecodeMode,
  type StandaloneDocumentRuntime
} from './standaloneDocumentRuntime';

export type { StandaloneDecodeMode } from './standaloneDocumentRuntime';

/**
 * Owns the host-neutral workspace controller for the standalone web and
 * Electron shells. React subscribes to one immutable workspace projection;
 * opaque File handles remain aligned with their DocumentSession lifetime.
 */
export const useStandaloneDocumentWorkspace = () => {
  const controller = useMemo(
    () => new DocumentWorkspaceController<StandaloneDocumentRuntime>(),
    []
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const documents = useMemo(
    () => projectStandaloneDocumentWorkspace(controller, snapshot),
    [controller, snapshot]
  );

  const openDocument = useCallback((
    file: File,
    decodeMode: StandaloneDecodeMode = 'automatic'
  ) => controller.open({
    source: {
      id: standaloneSourceIdentity(file, decodeMode),
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      byteLength: file.size
    },
    title: file.name,
    payload: { file, decodeMode }
  }), [controller]);

  const closeDocument = useCallback((
    id: DocumentSessionId,
    discardChanges = false
  ) => controller.close(id, { discardChanges }), [controller]);
  const activateDocument = useCallback(
    (id: DocumentSessionId) => controller.activate(id),
    [controller]
  );

  return {
    snapshot,
    documents,
    openDocument,
    closeDocument,
    activateDocument
  };
};
