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
import { useStandaloneFileDrop } from './useStandaloneFileDrop';
import { requestWorkspaceDocumentClose } from './requestWorkspaceDocumentClose';
import {
  imagePickerAccept,
  imagePickerFormatNames
} from '../lighttable/image-io/supportedImageFormats';

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
  const fileDrop = useStandaloneFileDrop(openDocument);

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
      <main
        className={`lighttable-launcher${fileDrop.active ? ' lighttable-launcher--drop-active' : ''}`}
      >
        <section className="lighttable-launcher__card">
          <h1>LightTable</h1>
          <p>
            Drop a supported file here, or open an image or layered document.
          </p>
          <span className="lighttable-launcher__formats">
            {imagePickerFormatNames('automatic')}
          </span>
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
                accept={imagePickerAccept('automatic')}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = '';
                  if (file) openDocument(file);
                }}
              />
            </label>
          )}
          {fileDrop.error ? (
            <p className="lighttable-file-drop__error" role="alert">
              {fileDrop.error}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <>
      {fileDrop.active ? (
        <div className="lighttable-file-drop" aria-hidden="true">
          <div className="lighttable-file-drop__message">
            Drop to open in a new document
          </div>
        </div>
      ) : null}
      {fileDrop.error ? (
        <button
          className="lighttable-file-drop__notice"
          type="button"
          role="alert"
          onClick={fileDrop.clearError}
        >
          {fileDrop.error}
        </button>
      ) : null}
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
