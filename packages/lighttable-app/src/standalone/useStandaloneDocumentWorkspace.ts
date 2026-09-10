import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';
import {
  type DocumentSession,
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
import {
  VideoDocumentSession,
  isSupportedVideoDocument
} from '@lighttable/video-core';
import type { Result } from '../lighttable/application/shared/result';
import type { WorkspaceError } from '../lighttable/application/workspace/workspaceSession';
import { releaseExternalMediaSource, sourceByteLengthFor } from './externalMediaSource';
import { nextActiveDocumentAfterClose } from './workspaceDocumentCloseProjection';

export type { StandaloneDecodeMode } from './standaloneDocumentRuntime';

interface TypedWorkspaceState {
  readonly order: readonly DocumentSessionId[];
  readonly activeId: DocumentSessionId | null;
  readonly videos: ReadonlyMap<DocumentSessionId, {
    readonly file: File;
    readonly session: VideoDocumentSession;
  }>;
}

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
  const imageSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [typedState, setTypedState] = useState<TypedWorkspaceState>({
    order: [], activeId: null, videos: new Map()
  });
  const typedStateRef = useRef(typedState);
  const videosRef = useRef(typedState.videos);
  typedStateRef.current = typedState;
  const videoRegistryLeaseRef = useRef(0);
  videosRef.current = typedState.videos;
  const publishTypedState = useCallback((
    update: (current: TypedWorkspaceState) => TypedWorkspaceState
  ) => {
    const next = update(typedStateRef.current);
    typedStateRef.current = next;
    videosRef.current = next.videos;
    setTypedState(next);
    return next;
  }, []);
  const [videoProjectionVersion, setVideoProjectionVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = [...typedState.videos.values()].map(({ session }) => {
      const projectStructuralState = () => {
        const snapshot = session.getSnapshot();
        return JSON.stringify({
          lifecycle: snapshot.lifecycle,
          lifecycleError: snapshot.lifecycleError,
          metadata: snapshot.metadata
        });
      };
      let previous = projectStructuralState();
      return session.subscribe(() => {
        const next = projectStructuralState();
        if (next === previous) return;
        previous = next;
        setVideoProjectionVersion((version) => version + 1);
      });
    });
    return () => unsubscribe.forEach((release) => release());
  }, [typedState.videos]);
  useEffect(() => {
    const lease = ++videoRegistryLeaseRef.current;
    return () => {
      // Strict Mode reconnects effects while retaining hook state. Delay
      // terminal ownership cleanup so the reconnect can claim a new lease;
      // only an actual workspace unmount disposes retained video sessions.
      queueMicrotask(() => {
        if (videoRegistryLeaseRef.current !== lease) return;
        for (const { file, session } of videosRef.current.values()) {
          try { session.dispose(); } finally { releaseExternalMediaSource(file); }
        }
      });
    };
  }, []);

  const publishOpenedImage = useCallback((id: DocumentSessionId) => {
    publishTypedState((current) => ({
      ...current,
      order: current.order.includes(id) ? current.order : [...current.order, id],
      activeId: id
    }));
  }, [publishTypedState]);

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
    if (opened.ok) {
      opened.value.setStartupTimeline(startupTimeline);
      publishOpenedImage(opened.value.id);
    } else if (opened.error.code === 'duplicate-source') {
      const activeId = controller.getSnapshot().activeDocumentId;
      if (activeId) publishOpenedImage(activeId);
    }
    return opened;
  }, [controller, publishOpenedImage]);

  const openWorkspaceDocument = useCallback((
    file: File,
    decodeMode: StandaloneDecodeMode = 'automatic'
  ): Result<DocumentSession | VideoDocumentSession, WorkspaceError> => {
    if (!isSupportedVideoDocument({ name: file.name, mediaType: file.type })) {
      return openDocument(file, decodeMode);
    }
    const sourceId = standaloneSourceIdentity(file, decodeMode);
    const duplicate = [...typedStateRef.current.videos.entries()].find(([, value]) =>
      value.session.getSnapshot().source.id === sourceId
    );
    if (duplicate) {
      // A second desktop open owns a fresh streaming capability even when it
      // resolves to an already-open canonical source. Revoke that unused lease
      // immediately; the retained document keeps its original source alive.
      releaseExternalMediaSource(file);
      controller.deactivate();
      publishTypedState((current) => ({ ...current, activeId: duplicate[0] }));
      return { ok: false, error: { code: 'duplicate-source', sourceId } };
    }
    const id = `video-session-${crypto.randomUUID()}` as DocumentSessionId;
    const byteLength = sourceByteLengthFor(file);
    const session = new VideoDocumentSession({
      id: id as never,
      source: {
        id: sourceId,
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        byteLength
      }
    });
    controller.deactivate();
    publishTypedState((current) => {
      const videos = new Map(current.videos);
      videos.set(id, { file, session });
      return { order: [...current.order, id], activeId: id, videos };
    });
    return { ok: true, value: session };
  }, [controller, openDocument, publishTypedState]);

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
      publishOpenedImage(opened.value.id);
    }
    return opened;
  }, [controller, publishOpenedImage]);

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
      publishOpenedImage(opened.value.id);
    }
    return opened;
  }, [controller, publishOpenedImage]);

  const closeDocument = useCallback((
    id: DocumentSessionId,
    discardChanges = false
  ) => {
    const currentState = typedStateRef.current;
    const video = currentState.videos.get(id);
    if (video) {
      video.session.beginClose();
      try { video.session.dispose(); } finally { releaseExternalMediaSource(video.file); }
      const next = publishTypedState((current) => {
        const order = current.order.filter((candidate) => candidate !== id);
        const videos = new Map(current.videos);
        videos.delete(id);
        const activeId = nextActiveDocumentAfterClose(current.order, current.activeId, id);
        if (activeId && !videos.has(activeId)) controller.activate(activeId);
        else if (!activeId || videos.has(activeId)) controller.deactivate();
        return { order, activeId, videos };
      });
      return { ok: true, value: { activeDocumentId: next.activeId } } as const;
    }
    const closed = controller.close(id, { discardChanges });
    if (closed.ok) {
      const next = publishTypedState((current) => {
        const order = current.order.filter((candidate) => candidate !== id);
        const activeId = nextActiveDocumentAfterClose(current.order, current.activeId, id);
        if (activeId && !current.videos.has(activeId)) controller.activate(activeId);
        else if (!activeId || current.videos.has(activeId)) controller.deactivate();
        return { ...current, order, activeId };
      });
      return { ok: true, value: { activeDocumentId: next.activeId } } as const;
    }
    return closed;
  }, [controller, publishTypedState]);
  const activateDocument = useCallback(
    (id: DocumentSessionId) => {
      const current = typedStateRef.current;
      if (!current.order.includes(id)) {
        return { ok: false, error: { code: 'document-not-found', documentId: id } } as const;
      }
      if (current.videos.has(id)) controller.deactivate();
      else controller.activate(id);
      publishTypedState((state) => ({ ...state, activeId: id }));
      return { ok: true, value: undefined } as const;
    },
    [controller, publishTypedState]
  );

  const imageDocuments = useMemo(
    () => projectStandaloneDocumentWorkspace(controller, imageSnapshot),
    [controller, imageSnapshot]
  );
  const documents = useMemo(() => {
    const images = new Map(imageDocuments.map((document) => [document.id, document]));
    return typedState.order.flatMap((id) => {
      const image = images.get(id);
      if (image) return [{ ...image, active: typedState.activeId === id }];
      const video = typedState.videos.get(id);
      if (!video) return [];
      return [{
        id,
        kind: 'video' as const,
        title: video.file.name,
        dirty: false as const,
        active: typedState.activeId === id,
        runtime: { kind: 'video' as const, file: video.file },
        session: video.session
      }];
    });
  }, [imageDocuments, typedState]);
  const snapshot = useMemo(() => ({
    documentOrder: typedState.order,
    activeDocumentId: typedState.activeId,
    documents: Object.fromEntries(documents.map((document) => [document.id,
      document.kind === 'image'
        ? imageSnapshot.documents[document.id]
        : { lifecycle: document.session.getSnapshot().lifecycle, dirty: false }
    ]))
  }), [documents, imageSnapshot.documents, typedState.activeId, typedState.order, videoProjectionVersion]);

  return {
    controller,
    snapshot,
    documents,
    openDocument,
    openWorkspaceDocument,
    openRecoveredDocument,
    openDuplicatedDocument,
    closeDocument,
    activateDocument
  };
};
