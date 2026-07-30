import {
  useCallback,
  useMemo,
  useState
} from 'react';
import { LightTableEditorOverlay } from '../lighttable/LightTableEditorOverlay';
import {
  type DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import { createBrowserHost, type LightTableHost } from '../platform/LightTableHost';
import { DocumentRuntimeErrorBoundary } from './DocumentRuntimeErrorBoundary';
import {
  type StandaloneDecodeMode,
  useStandaloneDocumentWorkspace
} from './useStandaloneDocumentWorkspace';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
}

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
  const {
    controller,
    workspace,
    snapshot,
    openDocument,
    closeDocument: closeWorkspaceDocument
  } = useStandaloneDocumentWorkspace();
  const [opening, setOpening] = useState(false);

  const requestHostDocument = useCallback(async (
    decodeMode: StandaloneDecodeMode = 'fast'
  ) => {
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
    closeWorkspaceDocument(id, true);
  }, [closeWorkspaceDocument, workspace]);

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
          <DocumentRuntimeErrorBoundary
            key={documentId}
            active={active}
            title={file.name}
            onClose={() => closeDocument(documentId)}
            onError={(message) => documentSession.setFailed(message)}
          >
            <LightTableEditorOverlay
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
          </DocumentRuntimeErrorBoundary>
        );
      })}
    </>
  );
}
