import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from 'react';
import { LightTableEditorOverlay } from '../lighttable/LightTableEditorOverlay';
import {
  type DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import { DocumentWorkspaceController } from '../lighttable/application/workspace/documentWorkspaceController';
import { createBrowserHost, type LightTableHost } from '../platform/LightTableHost';

type DecodeMode = 'fast' | 'preserve-precision';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
}

interface StandaloneDocumentRuntime {
  readonly file: File;
  readonly decodeMode: DecodeMode;
}

const sourceIdentity = (file: File, decodeMode: DecodeMode) =>
  `file:${file.name}:${file.size}:${file.lastModified}:${decodeMode}`;

const titleWithoutExtension = (name: string) =>
  name.replace(/\.[^.]+$/, '') || 'Untitled';

/**
 * Host-neutral workspace shell.
 *
 * Each open document owns a mounted editor runtime. Inactive runtimes stay
 * mounted so their undo stack, selections, tools, layers and GPU document
 * remain isolated and intact while another tab is active.
 */
export function LightTableStandaloneApp({
  host = createBrowserHost()
}: LightTableStandaloneAppProps) {
  const controller = useMemo(
    () => new DocumentWorkspaceController<StandaloneDocumentRuntime>(),
    []
  );
  const workspace = controller.workspace;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [opening, setOpening] = useState(false);

  useEffect(() => () => controller.dispose(), [controller]);

  const openDocument = useCallback((file: File, decodeMode: DecodeMode = 'fast') => {
    controller.open({
      source: {
        id: sourceIdentity(file, decodeMode),
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        byteLength: file.size
      },
      title: file.name,
      payload: { file, decodeMode }
    });
  }, [controller]);

  const requestHostDocument = useCallback(async (decodeMode: DecodeMode = 'fast') => {
    if (!host.openFile) return;
    setOpening(true);
    try {
      const file = await host.openFile();
      if (file) openDocument(file, decodeMode);
    } finally {
      setOpening(false);
    }
  }, [host, openDocument]);

  const closeDocument = useCallback((documentId: string) => {
    const id = documentId as DocumentSessionId;
    const document = workspace.getDocument(id);
    if (!document) return;
    if (
      document.getSnapshot().dirty
      && !window.confirm(`Discard unsaved changes to “${document.getSnapshot().title}”?`)
    ) {
      return;
    }
    controller.close(id, { discardChanges: true });
  }, [controller, workspace]);

  const workspaceDocuments = useMemo(
    () => snapshot.documentOrder.flatMap((id) => {
      const document = snapshot.documents[id];
      return document
        ? [{
            id,
            title: document.title,
            dirty: document.dirty
          }]
        : [];
    }),
    [snapshot.documentOrder, snapshot.documents]
  );

  if (snapshot.documentOrder.length === 0) {
    return (
      <main className="lighttable-launcher">
        <section className="lighttable-launcher__card">
          <h1>LightTable</h1>
          <p>Open an image or layered document to start.</p>
          {host.openFile ? (
            <button
              className="action-button lighttable-launcher__open"
              type="button"
              disabled={opening}
              onClick={() => void requestHostDocument()}
            >
              {opening ? 'Opening…' : 'Open file'}
            </button>
          ) : (
            <label className="action-button lighttable-launcher__open">
              Open file
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/tiff,image/avif,image/vnd.adobe.photoshop,.psd,.lighttable.png"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = '';
                  if (file) openDocument(file);
                }}
              />
            </label>
          )}
        </section>
      </main>
    );
  }

  return (
    <>
      {snapshot.documentOrder.map((documentId) => {
        const runtime = controller.getSource(documentId);
        const documentSession = controller.getDocument(documentId);
        if (!runtime || !documentSession) return null;
        const active = snapshot.activeDocumentId === documentId;
        const { file, decodeMode } = runtime;

        return (
          <LightTableEditorOverlay
            key={documentId}
            open
            active={active}
            projectId=""
            sourceBlob={file}
            sourceDecodeMode={decodeMode}
            fileNameBase={titleWithoutExtension(file.name)}
            subjectLabel={file.name}
            workspaceDocumentId={documentId}
            workspaceDocuments={workspaceDocuments}
            history={documentSession.history}
            tasks={documentSession.tasks}
            rendererLifecycle={documentSession.renderer}
            documentSession={documentSession}
            onActivateWorkspaceDocument={(id) => {
              workspace.activate(id as DocumentSessionId);
            }}
            onCloseWorkspaceDocument={closeDocument}
            onRequestOpenWorkspaceDocument={host.openFile
              ? requestHostDocument
              : undefined}
            onOpenWorkspaceDocument={openDocument}
            onDocumentReady={() => {
              const lifecycle = documentSession.getSnapshot().lifecycle;
              if (lifecycle !== 'ready') documentSession.setReady();
            }}
            onDocumentError={(message) => {
              documentSession.setFailed(message);
            }}
            onDirtyChange={(dirty) => {
              if (dirty) {
                documentSession.markChanged();
              } else {
                documentSession.markSaved();
              }
            }}
            onClose={() => closeDocument(documentId)}
            onSave={async (output, recipe) => {
              const saved = await host.save({ file: output, recipe });
              if (saved !== false) documentSession.markSaved();
              return saved;
            }}
          />
        );
      })}
    </>
  );
}
