import {
  LightTableEditorOverlay,
  type EditorScreenMode
} from '../lighttable/LightTableEditorOverlay';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type {
  LightTableHost,
  LightTableRecentFile
} from '../platform/LightTableHost';
import { DocumentRuntimeErrorBoundary } from './DocumentRuntimeErrorBoundary';
import type {
  StandaloneWorkspaceDocument
} from './projectStandaloneDocumentWorkspace';
import type {
  StandaloneDecodeMode
} from './standaloneDocumentRuntime';
import type {
  LightTableCommandPortRegistry,
  LightTableCommandService
} from '../lighttable/application/commands/lightTableCommandService';

export interface WorkspaceDocumentTab {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly dirty: boolean;
}

interface StandaloneDocumentRuntimeViewProps {
  readonly document: StandaloneWorkspaceDocument;
  readonly workspaceDocuments: readonly WorkspaceDocumentTab[];
  readonly host: LightTableHost;
  readonly commandService: LightTableCommandService;
  readonly commandPorts: LightTableCommandPortRegistry;
  readonly screenMode: EditorScreenMode;
  readonly onScreenModeChange: (mode: EditorScreenMode) => void;
  readonly onActivate: (id: DocumentSessionId) => void;
  readonly onClose: (id: DocumentSessionId) => void;
  readonly onRequestOpen?: (decodeMode?: StandaloneDecodeMode) => Promise<void>;
  readonly recentFiles: readonly LightTableRecentFile[];
  readonly onOpenRecent: (id: string) => Promise<void>;
  readonly onClearRecent: () => Promise<void>;
  readonly onRequestNew: () => void;
  readonly onOpen: (
    file: File,
    decodeMode?: StandaloneDecodeMode
  ) => unknown;
}

const titleWithoutExtension = (name: string) =>
  name.replace(/\.[^.]+$/, '') || 'Untitled';

/**
 * React composition boundary for exactly one open document runtime.
 *
 * A runtime owns its error containment, application services and host save
 * bridge. The workspace shell only controls ordering and activation.
 */
export function StandaloneDocumentRuntimeView({
  document,
  workspaceDocuments,
  host,
  commandService,
  commandPorts,
  screenMode,
  onScreenModeChange,
  onActivate,
  onClose,
  onRequestOpen,
  recentFiles,
  onOpenRecent,
  onClearRecent,
  onRequestNew,
  onOpen
}: StandaloneDocumentRuntimeViewProps) {
  const {
    id,
    active,
    runtime: { file, decodeMode },
    session
  } = document;

  return (
    <DocumentRuntimeErrorBoundary
      active={active}
      title={file.name}
      onClose={() => onClose(id)}
      onError={(message) => session.setFailed(message)}
    >
      <LightTableEditorOverlay
        open
        active={active}
        screenMode={screenMode}
        onScreenModeChange={onScreenModeChange}
        projectId=""
        sourceBlob={file}
        sourceDecodeMode={decodeMode}
        fileNameBase={titleWithoutExtension(file.name)}
        subjectLabel={file.name}
        workspaceDocumentId={id}
        workspaceDocuments={workspaceDocuments}
        history={session.history}
        tasks={session.tasks}
        rendererLifecycle={session.renderer}
        documentSession={session}
        commandService={commandService}
        commandPorts={commandPorts}
        imageClipboard={host.clipboard}
        onActivateWorkspaceDocument={(documentId) => {
          onActivate(documentId as DocumentSessionId);
        }}
        onCloseWorkspaceDocument={(documentId) => {
          onClose(documentId as DocumentSessionId);
        }}
        onRequestOpenWorkspaceDocument={onRequestOpen}
        recentFiles={recentFiles}
        onOpenRecentWorkspaceDocument={onOpenRecent}
        onClearRecentWorkspaceDocuments={onClearRecent}
        onRequestNewWorkspaceDocument={onRequestNew}
        onOpenWorkspaceDocument={onOpen}
        onDocumentReady={() => {
          if (session.getSnapshot().lifecycle !== 'ready') session.setReady();
        }}
        onDocumentError={(message) => session.setFailed(message)}
        onDirtyChange={(dirty) => {
          if (dirty) {
            session.markChanged();
          } else {
            session.markSaved();
          }
        }}
        onClose={() => onClose(id)}
        onSave={(output, recipe, transaction) => host.save({
          file: output,
          recipe,
          transaction
        })}
        onExportFile={(file) => host.save({ file, recipe: null })}
      />
    </DocumentRuntimeErrorBoundary>
  );
}
