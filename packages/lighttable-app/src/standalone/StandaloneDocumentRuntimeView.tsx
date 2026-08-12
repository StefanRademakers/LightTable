import { useCallback } from 'react';
import {
  LightTableEditorOverlay,
  type EditorScreenMode
} from '../lighttable/LightTableEditorOverlay';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import type {
  LightTableHost,
  LightTableRecentFile,
  LightTableProjectSummary,
  LightTableRecentProject
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
import type { GenAiGenerationJob } from '@lighttable/genai-core';

export interface WorkspaceDocumentTab {
  readonly id: DocumentSessionId;
  readonly title: string;
  readonly dirty: boolean;
  readonly thumbnailUrl?: string;
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
  readonly activeProject: LightTableProjectSummary | null;
  readonly recentProjects: readonly LightTableRecentProject[];
  readonly onRequestNewProject: () => void;
  readonly onRequestOpenProject: () => void;
  readonly onOpenRecentProject: (recentId: string) => void;
  readonly onClearRecentProjects: () => void;
  readonly onCloseProject: () => void;
  readonly onRevealProject: () => void;
  readonly onRequestNew: () => void;
  readonly onStartGuidedSample?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onOpenStyleGuide?: () => void;
  readonly preferences: ApplicationPreferences;
  readonly onOpen: (
    file: File,
    decodeMode?: StandaloneDecodeMode
  ) => unknown;
  readonly onRecoveryResolved: (recoveryId: string) => void;
  readonly onDocumentThumbnailChange: (documentId: DocumentSessionId, thumbnail: Blob) => void;
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
  activeProject,
  recentProjects,
  onRequestNewProject,
  onRequestOpenProject,
  onOpenRecentProject,
  onClearRecentProjects,
  onCloseProject,
  onRevealProject,
  onRequestNew,
  onStartGuidedSample,
  onOpenSettings,
  onOpenStyleGuide,
  preferences,
  onOpen,
  onRecoveryResolved,
  onDocumentThumbnailChange
}: StandaloneDocumentRuntimeViewProps) {
  const {
    id,
    active,
    runtime: { file, decodeMode, creationSettings },
    session
  } = document;

  const importGeneratedResult = useCallback(async (job: GenAiGenerationJob, forceOpen = false) => {
    const result = job.results[0];
    if (!result || !activeProject || !host.genAi) return;
    const payload = await host.genAi.loadProjectAsset(activeProject.id, result.assetId);
    if (!payload) return;
    const file = new File([Uint8Array.from(payload.bytes).buffer], payload.name, { type: payload.mediaType });
    const imageEdit = String(job.request.workflowId).toLocaleLowerCase('en-US').includes('image2image');
    if (forceOpen || !imageEdit) {
      onOpen(file);
      return;
    }
    const artifact = commandService.registerInputArtifact(file);
    await commandService.execute({
      protocolVersion: 1,
      requestId: `genai-place-${crypto.randomUUID()}`,
      command: 'layer.placeArtifact',
      documentId: id,
      parameters: { artifactId: artifact.id }
    });
  }, [activeProject, commandService, host.genAi, id, onOpen]);
  const handleGeneratedResult = useCallback((job: GenAiGenerationJob) => {
    void importGeneratedResult(job);
  }, [importGeneratedResult]);
  const handleOpenGeneratedResult = useCallback((job: GenAiGenerationJob) => {
    void importGeneratedResult(job, true);
  }, [importGeneratedResult]);
  const handleOpenGenAiAsset = useCallback(async (asset: import('@lighttable/genai-core').GenAiAssetReference) => {
    if (!activeProject || !host.genAi) return;
    const payload = await host.genAi.loadProjectAsset(activeProject.id, asset.id);
    if (!payload) return;
    onOpen(new File([Uint8Array.from(payload.bytes).buffer], payload.name, { type: payload.mediaType }));
  }, [activeProject, host.genAi, onOpen]);

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
        toolPreferences={preferences.tools}
        releaseService={host.release}
        genAiService={host.genAi}
        onGenAiGenerationSucceeded={handleGeneratedResult}
        onGenAiOpenResult={handleOpenGeneratedResult}
        onGenAiOpenAsset={handleOpenGenAiAsset}
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
        activeProject={activeProject}
        recentProjects={recentProjects}
        onRequestNewProject={onRequestNewProject}
        onRequestOpenProject={onRequestOpenProject}
        onOpenRecentProject={onOpenRecentProject}
        onClearRecentProjects={onClearRecentProjects}
        onCloseProject={onCloseProject}
        onRevealProject={onRevealProject}
        onRequestNewWorkspaceDocument={onRequestNew}
        onStartGuidedSample={onStartGuidedSample}
        onOpenSettings={onOpenSettings}
        onOpenStyleGuide={onOpenStyleGuide}
        onOpenWorkspaceDocument={onOpen}
        onDocumentReady={() => {
          if (session.getSnapshot().lifecycle !== 'ready') session.setReady();
          if (document.runtime.recovery && !session.getSnapshot().dirty) session.markChanged();
        }}
        onDocumentThumbnailChange={(thumbnail) => onDocumentThumbnailChange(id, thumbnail)}
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
          projectManifestPath: activeProject?.manifestPath,
          transaction
        })}
        onExportFile={(file) => host.save({ file, recipe: null })}
      />
    </DocumentRuntimeErrorBoundary>
  );
}
