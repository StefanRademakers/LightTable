import {
  useCallback,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction
} from 'react';
import type {
  DocumentSession,
  DocumentViewport
} from '../../application/documents/documentSession';
import {
  createEditorSession,
  type EditorSession
} from '../session/editorSession';

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
  documentSession?: DocumentSession
): [EditorSession, Dispatch<SetStateAction<EditorSession>>] => {
  const [localSession, setLocalSession] = useState<EditorSession>(createEditorSession);
  const subscribe = documentSession?.subscribe ?? subscribeToNothing;
  const getSnapshot = documentSession
    ? () => documentSession.getSnapshot().editor
    : () => localSession;
  const editorSession = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const updateEditorSession = useCallback<Dispatch<SetStateAction<EditorSession>>>(
    (update) => {
      if (documentSession) {
        documentSession.updateEditor((current) => resolveUpdate(current, update));
        return;
      }
      setLocalSession(update);
    },
    [documentSession]
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

  return {
    zoomMode: viewport.zoomMode,
    view: {
      scale: viewport.scale,
      panX: viewport.panX,
      panY: viewport.panY
    },
    setZoomMode,
    setView
  };
};
