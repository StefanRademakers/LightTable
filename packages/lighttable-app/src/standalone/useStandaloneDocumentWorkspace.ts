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
  const imageSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [typedState, setTypedState] = useState<{
    readonly order: readonly DocumentSessionId[];
    readonly activeId: DocumentSessionId | null;
    readonly videos: ReadonlyMap<DocumentSessionId, {
      readonly file: File;
      readonly session: VideoDocumentSession;
    }>;
  }>({ order: [], activeId: null, videos: new Map() });
  const videosRef = useRef(typedState.videos);
  const videoRegistryLeaseRef = useRef(0);
  videosRef.current = typedState.videos;
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
          session.dispose();
          releaseExternalMediaSource(file);
        }
      });
    };
  }, []);

  const publishOpenedImage = useCallback((id: DocumentSessionId) => {
    setTypedState((current) => ({
      ...current,
      order: current.order.includes(id) ? current.order : [...current.order, id],
      activeId: id
    }));
  }, []);

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
    const duplicate = [...typedState.videos.entries()].find(([, value]) =>
      value.session.getSnapshot().source.id === sourceId
    );
    if (duplicate) {
      // A second desktop open owns a fresh streaming capability even when it
      // resolves to an already-open canonical source. Revoke that unused lease
      // immediately; the retained document keeps its original source alive.
      releaseExternalMediaSource(file);
      controller.deactivate();
      setTypedState((current) => ({ ...current, activeId: duplicate[0] }));
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
    setTypedState((current) => {
      const videos = new Map(current.videos);
      videos.set(id, { file, session });
      return { order: [...current.order, id], activeId: id, videos };
    });
    return { ok: true, value: session };
  }, [controller, openDocument, typedState.videos]);

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
    const video = typedState.videos.get(id);
    if (video) {
      video.session.beginClose();
      video.session.dispose();
      releaseExternalMediaSource(video.file);
      setTypedState((current) => {
        const index = current.order.indexOf(id);
        const order = current.order.filter((candidate) => candidate !== id);
        const videos = new Map(current.videos);
        videos.delete(id);
        const activeId = current.activeId === id
          ? order[Math.min(Math.max(index, 0), order.length - 1)] ?? null
          : current.activeId;
        if (activeId && !videos.has(activeId)) controller.activate(activeId);
        else if (!activeId || videos.has(activeId)) controller.deactivate();
        return { order, activeId, videos };
      });
      return { ok: true, value: undefined } as const;
    }
    const closed = controller.close(id, { discardChanges });
    if (closed.ok) {
      setTypedState((current) => {
        const index = current.order.indexOf(id);
        const order = current.order.filter((candidate) => candidate !== id);
        const activeId = current.activeId === id
          ? order[Math.min(Math.max(index, 0), order.length - 1)] ?? null
          : current.activeId;
        if (activeId && !current.videos.has(activeId)) controller.activate(activeId);
        else if (!activeId || current.videos.has(activeId)) controller.deactivate();
        return { ...current, order, activeId };
      });
    }
    return closed;
  }, [controller, typedState.videos]);
  const activateDocument = useCallback(
    (id: DocumentSessionId) => {
      if (!typedState.order.includes(id)) {
        return { ok: false, error: { code: 'document-not-found', documentId: id } } as const;
      }
      if (typedState.videos.has(id)) controller.deactivate();
      else controller.activate(id);
      setTypedState((current) => ({ ...current, activeId: id }));
      return { ok: true, value: undefined } as const;
    },
    [controller, typedState.order, typedState.videos]
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
