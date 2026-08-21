import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction
} from 'react';
import type {
  DocumentSession,
  DocumentViewport
} from '../../application/documents/documentSession';
import type { EditorApplicationSession } from '../../application/workspace/editorApplicationSession';
import {
  createEditorSession,
  documentEditorStateFrom,
  editorApplicationStateFrom,
  mergeEditorSession,
  type EditorSession
} from '../session/editorSession';
import type { ImageDocument } from '../document/documentTypes';

const subscribeToNothing = () => () => undefined;

const resolveUpdate = <T,>(current: T, update: SetStateAction<T>): T => (
  typeof update === 'function'
    ? (update as (value: T) => T)(current)
    : update
);

/**
 * React adapter for document-owned tool, selection and brush state.
 *
 * The editor may still run without a workspace session in embedded hosts, but
 * standalone/multi-document hosts use DocumentSession as the source of truth.
 */
export const useDocumentEditorSession = (
  documentSession?: DocumentSession,
  applicationSession?: EditorApplicationSession
): [EditorSession, Dispatch<SetStateAction<EditorSession>>] => {
  const [localSession, setLocalSession] = useState<EditorSession>(createEditorSession);
  const localDocumentState = useMemo(
    () => documentEditorStateFrom(localSession),
    [localSession]
  );
  const localApplicationState = useMemo(
    () => editorApplicationStateFrom(localSession),
    [localSession]
  );
  const documentSubscribe = documentSession?.subscribe ?? subscribeToNothing;
  const getDocumentSnapshot = documentSession
    ? () => documentSession.getSnapshot().editor
    : () => localDocumentState;
  const documentState = useSyncExternalStore(
    documentSubscribe,
    getDocumentSnapshot,
    getDocumentSnapshot
  );
  const applicationSubscribe = applicationSession?.subscribe ?? subscribeToNothing;
  const getApplicationSnapshot = applicationSession
    ? applicationSession.getSnapshot
    : () => localApplicationState;
  const applicationState = useSyncExternalStore(
    applicationSubscribe,
    getApplicationSnapshot,
    getApplicationSnapshot
  );
  const editorSession = useMemo(
    () => mergeEditorSession(applicationState, documentState),
    [applicationState, documentState]
  );
  const editorSessionRef = useRef(editorSession);
  editorSessionRef.current = editorSession;

  const updateEditorSession = useCallback<Dispatch<SetStateAction<EditorSession>>>(
    (update) => {
      const current = editorSessionRef.current;
      const next = resolveUpdate(current, update);
      const documentInteractionChanged = next.activeChannel !== current.activeChannel
        || next.selection !== current.selection
        || next.vectorSelection !== current.vectorSelection;
      if (documentInteractionChanged) {
        documentSession?.updateEditor(() => documentEditorStateFrom(next));
      }
      applicationSession?.publishCombinedSession(next);
      if (!documentSession || !applicationSession) setLocalSession(next);
    },
    [applicationSession, documentSession]
  );

  return [editorSession, updateEditorSession];
};

export interface DocumentViewportState {
  readonly zoomMode: DocumentViewport['zoomMode'];
  readonly view: {
    readonly scale: number;
    readonly panX: number;
    readonly panY: number;
  };
  readonly setZoomMode: Dispatch<SetStateAction<DocumentViewport['zoomMode']>>;
  readonly setView: Dispatch<SetStateAction<DocumentViewportState['view']>>;
  readonly setViewport: Dispatch<SetStateAction<DocumentViewport>>;
}

const createDefaultViewport = (): DocumentViewport => ({
  zoomMode: 'fit',
  scale: 1,
  panX: 0,
  panY: 0
});

/**
 * Keeps zoom and pan attached to the document instead of the mounted viewport.
 * Switching tabs therefore cannot leak camera state.
 */
export const useDocumentViewportState = (
  documentSession?: DocumentSession
): DocumentViewportState => {
  const [localViewport, setLocalViewport] = useState<DocumentViewport>(
    createDefaultViewport
  );
  const subscribe = documentSession?.subscribe ?? subscribeToNothing;
  const getSnapshot = documentSession
    ? () => documentSession.getSnapshot().viewport
    : () => localViewport;
  const viewport = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setZoomMode = useCallback<
    Dispatch<SetStateAction<DocumentViewport['zoomMode']>>
  >((update) => {
    const apply = (current: DocumentViewport): DocumentViewport => ({
      ...current,
      zoomMode: resolveUpdate(current.zoomMode, update)
    });
    if (documentSession) documentSession.updateViewport(apply);
    else setLocalViewport(apply);
  }, [documentSession]);

  const setView = useCallback<
    Dispatch<SetStateAction<DocumentViewportState['view']>>
  >((update) => {
    const apply = (current: DocumentViewport): DocumentViewport => {
      const next = resolveUpdate({
        scale: current.scale,
        panX: current.panX,
        panY: current.panY
      }, update);
      return { ...current, ...next };
    };
    if (documentSession) documentSession.updateViewport(apply);
    else setLocalViewport(apply);
  }, [documentSession]);

  const setViewport = useCallback<Dispatch<SetStateAction<DocumentViewport>>>(
    (update) => {
      const apply = (current: DocumentViewport): DocumentViewport => ({
        ...resolveUpdate(current, update)
      });
      if (documentSession) documentSession.updateViewport(apply);
      else setLocalViewport(apply);
    },
    [documentSession]
  );

  return {
    zoomMode: viewport.zoomMode,
    view: {
      scale: viewport.scale,
      panX: viewport.panX,
      panY: viewport.panY
    },
    setZoomMode,
    setView,
    setViewport
  };
};

/**
 * React adapter for the canonical immutable document tree.
 *
 * The returned ref is updated synchronously with local commands so pointer and
 * GPU callbacks never observe the previous React render. In a workspace the
 * same value also lives on DocumentSession, keeping it isolated per tab.
 */
export const useDocumentImageState = (
  documentSession?: DocumentSession
): [
  ImageDocument | null,
  Dispatch<SetStateAction<ImageDocument | null>>,
  MutableRefObject<ImageDocument | null>
] => {
  const [localDocument, setLocalDocument] = useState<ImageDocument | null>(null);
  const subscribe = documentSession?.subscribe ?? subscribeToNothing;
  const getSnapshot = documentSession
    ? () => documentSession.getSnapshot().document
    : () => localDocument;
  const document = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const documentRef = useRef<ImageDocument | null>(document);
  documentRef.current = document;

  const setDocument = useCallback<Dispatch<SetStateAction<ImageDocument | null>>>(
    (update) => {
      const current = documentRef.current;
      const next = resolveUpdate(current, update);
      documentRef.current = next;
      if (documentSession) documentSession.setDocument(next);
      else setLocalDocument(next);
    },
    [documentSession]
  );

  return [document, setDocument, documentRef];
};
