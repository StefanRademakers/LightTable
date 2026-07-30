import {
  useCallback,
  useMemo,
  useState
} from 'react';
import {
  type DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import { createBrowserHost, type LightTableHost } from '../platform/LightTableHost';
import { StandaloneDocumentRuntimeView } from './StandaloneDocumentRuntimeView';
import {
  type StandaloneDecodeMode,
  useStandaloneDocumentWorkspace
} from './useStandaloneDocumentWorkspace';
import { requestWorkspaceDocumentClose } from './requestWorkspaceDocumentClose';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
}

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
    snapshot,
    documents,
    openDocument,
    closeDocument: closeWorkspaceDocument,
    activateDocument
  } = useStandaloneDocumentWorkspace();
  const [opening, setOpening] = useState(false);

  const requestHostDocument = useCallback(async (
    decodeMode: StandaloneDecodeMode = 'automatic'
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
    void requestWorkspaceDocumentClose({
      documentId: id,
      documents,
      host,
      close: closeWorkspaceDocument
    });
  }, [closeWorkspaceDocument, documents, host]);

  const workspaceDocuments = useMemo(
    () => documents.map(({ id, title, dirty }) => ({ id, title, dirty })),
    [documents]
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
                accept="image/png,image/jpeg,image/webp,image/tiff,image/vnd.adobe.photoshop,.psd,.psb,.lighttable.png"
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
      {documents.map((document) => {
        return (
          <StandaloneDocumentRuntimeView
            key={document.id}
            document={document}
            workspaceDocuments={workspaceDocuments}
            host={host}
            onActivate={activateDocument}
            onClose={closeDocument}
            onRequestOpen={host.openFile ? requestHostDocument : undefined}
            onOpen={openDocument}
          />
        );
      })}
    </>
  );
}
