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
import type { ApplicationPreferences } from './applicationPreferences';

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
  readonly onRequestPlace?: (documentId: DocumentSessionId) => Promise<void>;
  readonly recentFiles: readonly LightTableRecentFile[];
  readonly onOpenRecent: (id: string) => Promise<void>;
  readonly onClearRecent: () => Promise<void>;
  readonly onRequestNew: () => void;
  readonly onStartGuidedSample?: () => void;
  readonly onOpenSettings?: () => void;
  readonly preferences: ApplicationPreferences;
  readonly onOpen: (
    file: File,
    decodeMode?: StandaloneDecodeMode
  ) => unknown;
  readonly onRecoveryResolved: (recoveryId: string) => void;
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
  onRequestPlace,
  recentFiles,
  onOpenRecent,
  onClearRecent,
  onRequestNew,
  onStartGuidedSample,
  onOpenSettings,
  preferences,
  onOpen,
  onRecoveryResolved
}: StandaloneDocumentRuntimeViewProps) {
  const {
    id,
    active,
    runtime: { file, decodeMode, creationSettings },
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
        documentCreationSettings={creationSettings}
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
        recoveryStore={host.recovery}
        recoveryPreferences={preferences.autosave}
        releaseService={host.release}
        hostKind={host.kind}
        recoveryNotice={document.runtime.recovery
          ? `${document.runtime.recovery.crashLoop ? 'Safe mode: ' : ''}Recovered copy of ${document.runtime.recovery.originalName}. Save creates a new file.`
          : null}
        onRecoveryResolved={document.runtime.recovery
          ? () => onRecoveryResolved(document.runtime.recovery!.recoveryId)
          : undefined}
        onActivateWorkspaceDocument={(documentId) => {
          onActivate(documentId as DocumentSessionId);
        }}
        onCloseWorkspaceDocument={(documentId) => {
          onClose(documentId as DocumentSessionId);
        }}
        onRequestOpenWorkspaceDocument={onRequestOpen}
        onRequestPlaceWorkspaceArtifact={(documentId) => onRequestPlace?.(documentId as DocumentSessionId)}
        recentFiles={recentFiles}
        onOpenRecentWorkspaceDocument={onOpenRecent}
        onClearRecentWorkspaceDocuments={onClearRecent}
        onRequestNewWorkspaceDocument={onRequestNew}
        onStartGuidedSample={onStartGuidedSample}
        onOpenSettings={onOpenSettings}
        onOpenWorkspaceDocument={onOpen}
        onDocumentReady={() => {
          if (session.getSnapshot().lifecycle !== 'ready') session.setReady();
          if (document.runtime.recovery && !session.getSnapshot().dirty) session.markChanged();
        }}
        onDocumentError={(message) => session.setFailed(message)}
        onDirtyChange={(dirty) => {
          if (dirty) {
            session.markChanged();
          } else if (!document.runtime.recovery) {
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
