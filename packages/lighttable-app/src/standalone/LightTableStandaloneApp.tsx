import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import { type DocumentSessionId } from '../lighttable/application/documents/documentSession';
import {
  createBrowserHost,
  type LightTableHost,
  type LightTableRecentFile
} from '../platform/LightTableHost';
import { StandaloneDocumentRuntimeView } from './StandaloneDocumentRuntimeView';
import type { EditorScreenMode } from '../lighttable/LightTableEditorOverlay';
import { screenModeUsesHostFullscreen } from '../lighttable/editor/workspace/editorScreenMode';
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
import { createBlankPngFile } from './createBlankPngFile';
import { NewDocumentDialog } from './NewDocumentDialog';
import {
  LightTableCommandPortRegistry,
  LightTableCommandService
} from '../lighttable/application/commands/lightTableCommandService';

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
    controller,
    snapshot,
    documents,
    openDocument,
    closeDocument: closeWorkspaceDocument,
    activateDocument
  } = useStandaloneDocumentWorkspace(host.systemFontProvider);
  const commandPorts = useMemo(() => new LightTableCommandPortRegistry(), []);
  const commandService = useMemo(
    () => new LightTableCommandService(controller.workspace, commandPorts, {
      openArtifact: (file) => {
        const opened = openDocument(file);
        if (!opened.ok) throw new Error(`The artifact could not be opened: ${opened.error.code}.`);
        return opened.value.id;
      }
    }),
    [commandPorts, controller, openDocument]
  );
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<readonly LightTableRecentFile[]>([]);
  const [screenMode, setScreenMode] = useState<EditorScreenMode>('normal');
  const fileDrop = useStandaloneFileDrop(openDocument);

  useEffect(() => () => commandService.dispose(), [commandService]);
  useEffect(() => host.installAutomationDriver?.(commandService), [commandService, host]);
  useEffect(() => {
    let cancelled = false;
    void host.listSystemFonts?.().then((fonts) => {
      if (!cancelled) controller.workspace.registerSystemFontReferences(fonts);
    }).catch(() => {
      // System fonts are optional; bundled/document fonts remain available.
    });
    return () => { cancelled = true; };
  }, [controller, host]);

  const changeScreenMode = useCallback((mode: EditorScreenMode) => {
    setScreenMode(mode);
    void host.setFullscreen?.(screenModeUsesHostFullscreen(mode)).catch(() => {
      setScreenMode('normal');
    });
  }, [host]);

  useEffect(() => host.subscribeFullscreen?.((enabled) => {
    if (!enabled) setScreenMode('normal');
  }), [host]);

  useEffect(() => {
    if (snapshot.documentOrder.length === 0 && screenMode !== 'normal') {
      changeScreenMode('normal');
    }
  }, [changeScreenMode, screenMode, snapshot.documentOrder.length]);

  const refreshRecentFiles = useCallback(async () => {
    if (!host.listRecentFiles) {
      setRecentFiles([]);
      return;
    }
    try {
      setRecentFiles((await host.listRecentFiles()).slice(0, 4));
    } catch {
      setRecentFiles([]);
    }
  }, [host]);

  useEffect(() => {
    if (snapshot.documentOrder.length === 0) void refreshRecentFiles();
  }, [refreshRecentFiles, snapshot.documentOrder.length]);

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

  const openRecentDocument = useCallback(async (id: string) => {
    if (!host.openRecentFile) return;
    setOpening(true);
    try {
      const file = await host.openRecentFile(id);
      if (file) openDocument(file);
      else await refreshRecentFiles();
    } finally {
      setOpening(false);
    }
  }, [host, openDocument, refreshRecentFiles]);

  const createDocument = useCallback(async ({
    width,
    height
  }: { width: number; height: number }) => {
    setCreating(true);
    try {
      openDocument(await createBlankPngFile({ width, height, resolutionPpi: 72 }));
      setNewDialogOpen(false);
    } finally {
      setCreating(false);
    }
  }, [openDocument]);

  const requestNewDocument = useCallback(() => setNewDialogOpen(true), []);

  useEffect(() => {
    const handleNewShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey
        || event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      requestNewDocument();
    };
    window.addEventListener('keydown', handleNewShortcut, true);
    return () => window.removeEventListener('keydown', handleNewShortcut, true);
  }, [requestNewDocument]);

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
        <div className="lighttable-launcher__content">
          <div className="lighttable-launcher__start">
            <section className="lighttable-launcher__card lighttable-launcher__open-card">
              <h1>Open</h1>
              <p>Drop a supported file here, or choose a file.</p>
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

            <section className="lighttable-launcher__card lighttable-launcher__new-card">
              <h1>New document</h1>
              <p>Create an empty image document.</p>
              <button className="action-button lighttable-launcher__primary-action" type="button" onClick={requestNewDocument}>
                New document
              </button>
            </section>
          </div>

          {recentFiles.length > 0 ? (
            <section className="lighttable-launcher__recent-section">
              <h2>Recent files</h2>
              <div className="lighttable-launcher__recents">
                {recentFiles.map((recent) => (
                  <button key={recent.id} type="button" disabled={opening} onClick={() => void openRecentDocument(recent.id)}>
                    <span className="lighttable-launcher__recent-preview">
                      {recent.thumbnailUrl ? <img src={recent.thumbnailUrl} alt="" /> : <span>No preview</span>}
                    </span>
                    <span className="lighttable-launcher__recent-name" title={recent.name}>{recent.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <NewDocumentDialog
          open={newDialogOpen}
          clipboard={host.clipboard}
          creating={creating}
          onCancel={() => setNewDialogOpen(false)}
          onCreate={(size) => void createDocument(size)}
        />
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
      {documents.map((document) => (
        <StandaloneDocumentRuntimeView
          key={document.id}
          document={document}
          workspaceDocuments={workspaceDocuments}
          host={host}
          commandService={commandService}
          commandPorts={commandPorts}
          screenMode={screenMode}
          onScreenModeChange={changeScreenMode}
          onActivate={activateDocument}
          onClose={closeDocument}
          onRequestOpen={host.openFile ? requestHostDocument : undefined}
          onRequestNew={requestNewDocument}
          onOpen={openDocument}
        />
      ))}
      <NewDocumentDialog
        open={newDialogOpen}
        clipboard={host.clipboard}
        creating={creating}
        onCancel={() => setNewDialogOpen(false)}
        onCreate={(size) => void createDocument(size)}
      />
    </>
  );
}
