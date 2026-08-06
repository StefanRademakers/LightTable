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
import type { SystemFontByteProvider } from '../lighttable/text/fonts/DocumentFontRegistry';
import type { LightTableRecoveryRecord } from '../platform/LightTableRecoveryStore';
import type { DocumentCreationSettings } from '../lighttable/editor/document/documentTypes';

export type { StandaloneDecodeMode } from './standaloneDocumentRuntime';

/**
 * Owns the host-neutral workspace controller for the standalone web and
 * Electron shells. React subscribes to one immutable workspace projection;
 * opaque File handles remain aligned with their DocumentSession lifetime.
 */
export const useStandaloneDocumentWorkspace = (systemFontProvider?: SystemFontByteProvider) => {
  const controller = useMemo(
    () => new DocumentWorkspaceController<StandaloneDocumentRuntime>({ systemFontProvider }),
    [systemFontProvider]
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
    decodeMode: StandaloneDecodeMode = 'automatic',
    creationSettings?: DocumentCreationSettings
  ) => controller.open({
    source: {
      id: standaloneSourceIdentity(file, decodeMode),
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      byteLength: file.size
    },
    title: file.name,
    payload: { file, decodeMode, ...(creationSettings ? { creationSettings } : {}) }
  }), [controller]);

  const openRecoveredDocument = useCallback((
    file: File,
    record: LightTableRecoveryRecord,
    crashLoop: boolean
  ) => {
    const originalName = record.sourceName || 'Recovered document';
    const opened = controller.open({
      source: {
        id: `recovery:${record.recoveryId}:${file.size}`,
        name: originalName,
        mediaType: file.type || record.mediaType,
        byteLength: file.size
      },
      title: `${originalName} (Recovered)`,
      payload: {
        file,
        decodeMode: 'automatic',
        recovery: { recoveryId: record.recoveryId, originalName, crashLoop }
      }
    });
    if (opened.ok) opened.value.markChanged();
    return opened;
  }, [controller]);

  const closeDocument = useCallback((
    id: DocumentSessionId,
    discardChanges = false
  ) => controller.close(id, { discardChanges }), [controller]);
  const activateDocument = useCallback(
    (id: DocumentSessionId) => controller.activate(id),
    [controller]
  );

  return {
    controller,
    snapshot,
    documents,
    openDocument,
    openRecoveredDocument,
    closeDocument,
    activateDocument
  };
};
