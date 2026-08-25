import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { DocumentStartupTimeline } from '../lighttable/application/telemetry/documentStartupTimeline';
import { prepareSharedWebGpuDevice } from '../lighttable/gpu/sharedWebGpuDevice';

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
  const currentControllerRef = useRef(controller);
  const controllerLeaseRef = useRef(0);
  currentControllerRef.current = controller;
  useEffect(() => {
    const lease = ++controllerLeaseRef.current;
    return () => {
      // React Strict Mode reconnects effects without replacing their memoized
      // controller. Defer terminal disposal for one microtask so that reconnect
      // can claim a new lease; a real unmount or controller replacement cannot.
      queueMicrotask(() => {
        if (currentControllerRef.current !== controller || controllerLeaseRef.current === lease) {
          controller.dispose();
        }
      });
    };
  }, [controller]);
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
    creationSettings?: DocumentCreationSettings,
    suppliedTimeline?: DocumentStartupTimeline
  ) => {
    const startupTimeline = suppliedTimeline ?? new DocumentStartupTimeline();
    startupTimeline.mark('bytes-available', { byteLength: file.size });
    // A document open is an explicit user/host request. Start only the shared
    // GPU runtime here; no canvas or per-document resource is prewarmed. The
    // renderer created below will join this same in-flight request while source
    // probing and decoding continue in parallel.
    void prepareSharedWebGpuDevice().catch(() => undefined);
    const opened = controller.open({
      source: {
        id: standaloneSourceIdentity(file, decodeMode),
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        byteLength: file.size
      },
      title: file.name,
      payload: { kind: 'image', file, decodeMode, startupTimeline, ...(creationSettings ? { creationSettings } : {}) }
    });
    if (opened.ok) opened.value.setStartupTimeline(startupTimeline);
    return opened;
  }, [controller]);

  const openRecoveredDocument = useCallback((
    file: File,
    record: LightTableRecoveryRecord,
    crashLoop: boolean
  ) => {
    const originalName = record.sourceName || 'Recovered document';
    const startupTimeline = new DocumentStartupTimeline();
    startupTimeline.mark('bytes-available', { byteLength: file.size });
    const opened = controller.open({
      source: {
        id: `recovery:${record.recoveryId}:${file.size}`,
        name: originalName,
        mediaType: file.type || record.mediaType,
        byteLength: file.size
      },
      title: `${originalName} (Recovered)`,
      payload: {
        kind: 'image',
        file,
        decodeMode: 'automatic',
        startupTimeline,
        recovery: { recoveryId: record.recoveryId, originalName, crashLoop }
      }
    });
    if (opened.ok) {
      opened.value.setStartupTimeline(startupTimeline);
      opened.value.markChanged();
    }
    return opened;
  }, [controller]);

  const openDuplicatedDocument = useCallback((file: File, title: string) => {
    const startupTimeline = new DocumentStartupTimeline();
    startupTimeline.mark('bytes-available', { byteLength: file.size });
    const opened = controller.open({
      source: {
        id: `duplicate:${crypto.randomUUID()}`,
        name: title,
        mediaType: file.type || 'image/png',
        byteLength: file.size
      },
      title,
      payload: { kind: 'image', file, decodeMode: 'automatic', startupTimeline }
    });
    if (opened.ok) {
      opened.value.setStartupTimeline(startupTimeline);
      opened.value.markChanged();
    }
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
    openDuplicatedDocument,
    closeDocument,
    activateDocument
  };
};
