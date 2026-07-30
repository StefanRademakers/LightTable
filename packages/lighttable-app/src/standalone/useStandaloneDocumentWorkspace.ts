import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore
} from 'react';
import {
  type DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import {
  DocumentWorkspaceController
} from '../lighttable/application/workspace/documentWorkspaceController';
import { StrictModeSafeDisposal } from './strictModeSafeDisposal';

export type StandaloneDecodeMode = 'fast' | 'preserve-precision';

export interface StandaloneDocumentRuntime {
  readonly file: File;
  readonly decodeMode: StandaloneDecodeMode;
}

export const standaloneSourceIdentity = (
  file: File,
  decodeMode: StandaloneDecodeMode
) => `file:${file.name}:${file.size}:${file.lastModified}:${decodeMode}`;

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
  const controllerDisposal = useMemo(
    () => new StrictModeSafeDisposal(() => controller.dispose()),
    [controller]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  useEffect(
    () => controllerDisposal.connect(),
    [controllerDisposal]
  );

  const openDocument = useCallback((
    file: File,
    decodeMode: StandaloneDecodeMode = 'fast'
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

  return {
    controller,
    workspace: controller.workspace,
    snapshot,
    openDocument,
    closeDocument
  };
};
