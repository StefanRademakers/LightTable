import { useCallback, useRef, useState } from 'react';
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
import type { EditorApplicationSession } from '../lighttable/application/workspace/editorApplicationSession';
import type { DocumentTaskRegistry } from '../lighttable/application/tasks/documentTaskRegistry';
import type { DocumentRendererLifecycle } from '../lighttable/application/rendering/documentRendererLifecycle';
import type { GenAiGenerationJob } from '@lighttable/genai-core';
import { isImageEditGeneration } from '../genai/application/generationDelivery';
import { VideoDocumentSurface, type VideoViewportHandle } from './VideoDocumentSurface';
import { VideoControlsPanel } from './VideoControlsPanel';

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
  readonly applicationEditorSession: EditorApplicationSession;
  readonly applicationEditorTasks: DocumentTaskRegistry;
  readonly applicationRendererLifecycle: DocumentRendererLifecycle;
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
  readonly onExitApplication?: () => void;
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
 * Stable React composition boundary for the application's one editor runtime.
 *
 * Changing `document` rebinds that editor to another canonical session. It
 * must not create a second workspace, canvas or renderer runtime.
 */
export function StandaloneDocumentRuntimeView({
  document,
  workspaceDocuments,
  host,
  commandService,
  commandPorts,
  applicationEditorSession,
  applicationEditorTasks,
  applicationRendererLifecycle,
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
  onExitApplication,
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
  const { id, active, runtime: { file } } = document;
  const video = document.kind === 'video' ? document.session.getSnapshot() : null;
  const videoViewportRef = useRef<VideoViewportHandle>(null);
  const [videoZoomPercent, setVideoZoomPercent] = useState(100);
  const videoViewControls = document.kind === 'video' ? {
    zoomPercent: videoZoomPercent,
    onZoomPreset: (percent: number) => videoViewportRef.current?.setZoomPercent(percent),
    onZoomFit: () => videoViewportRef.current?.fit(),
    onZoomActual: () => videoViewportRef.current?.actual(),
    onZoomStep: (direction: -1 | 1) => videoViewportRef.current?.step(direction)
  } : undefined;

  const importGeneratedResult = useCallback(async (job: GenAiGenerationJob, forceOpen = false) => {
    const result = job.results[0];
    if (!result || !activeProject || !host.genAi) return;
    const payload = await host.genAi.loadProjectAsset(activeProject.id, result.assetId);
    if (!payload) return;
    const file = new File([Uint8Array.from(payload.bytes).buffer], payload.name, { type: payload.mediaType });
    const imageEdit = document.kind === 'image'
      && !result.mediaType.startsWith('video/')
      && isImageEditGeneration(job);
    if (forceOpen || !imageEdit) {
      onOpen(file);
      return;
    }
    if (document.kind !== 'image') {
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
  }, [activeProject, commandService, document.kind, host.genAi, id, onOpen]);
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

  const recovery = document.kind === 'image' ? document.runtime.recovery : undefined;
  const videoStatusMeta = video?.metadata
    ? `${video.metadata.width} × ${video.metadata.height} · ${formatVideoTime(video.metadata.durationSeconds)} video`
    : video?.lifecycle === 'failed' ? 'Video unavailable' : 'Loading video metadata…';

  return (
    <DocumentRuntimeErrorBoundary
      documentId={id}
      active={active}
      title={file.name}
      onClose={() => onClose(id)}
      onError={(message) => {
        if (document.kind === 'image') document.session.setFailed(message);
        else document.session.publishFailure(message);
      }}
    >
      <LightTableEditorOverlay
        open
        active={active}
        screenMode={screenMode}
        onScreenModeChange={onScreenModeChange}
        projectId=""
        sourceBlob={document.kind === 'image' ? file : null}
        sourceDecodeMode={document.kind === 'image' ? document.runtime.decodeMode : undefined}
        documentCreationSettings={document.kind === 'image' ? document.runtime.creationSettings : undefined}
        startupTimeline={document.kind === 'image' ? document.runtime.startupTimeline : undefined}
        documentSurfaceOverride={document.kind === 'video'
          ? ({ activeTool, zoomOutActive }) => <VideoDocumentSurface
              ref={videoViewportRef}
              file={file}
              session={document.session}
              active={active}
              activeTool={activeTool}
              zoomOutActive={zoomOutActive}
              zoomWithScrollWheel={preferences.tools.zoomWithScrollWheel}
              onZoomPercentChange={setVideoZoomPercent}
            />
          : undefined}
        workspaceDocumentKind={document.kind}
        workspaceViewControls={videoViewControls}
        workspaceVideoControlsPanel={document.kind === 'video' ? (
          <VideoControlsPanel
            session={document.session}
            commands={{
              togglePlayback: () => videoViewportRef.current?.togglePlayback(),
              seek: (seconds) => videoViewportRef.current?.seek(seconds),
              stepFrame: (direction) => videoViewportRef.current?.stepFrame(direction),
              setMuted: (muted) => videoViewportRef.current?.setMuted(muted),
              setVolume: (volume) => videoViewportRef.current?.setVolume(volume)
            }}
          />
        ) : undefined}
        workspaceStatusMeta={document.kind === 'video' ? videoStatusMeta : undefined}
        workspaceStatusTitle={document.kind === 'video'
          ? `${file.name} · read-only video document`
          : undefined}
        fileNameBase={titleWithoutExtension(file.name)}
        subjectLabel={file.name}
        workspaceDocumentId={id}
        workspaceDocuments={workspaceDocuments}
        history={document.kind === 'image' ? document.session.history : undefined}
        tasks={applicationEditorTasks}
        rendererLifecycle={applicationRendererLifecycle}
        documentSession={document.kind === 'image' ? document.session : undefined}
        applicationEditorSession={applicationEditorSession}
        commandService={commandService}
        commandPorts={commandPorts}
        imageClipboard={host.clipboard}
        recoveryStore={document.kind === 'image' ? host.recovery : undefined}
        recoveryPreferences={document.kind === 'image' ? preferences.autosave : undefined}
        toolPreferences={preferences.tools}
        genAiPreferences={preferences.genAi}
        releaseService={host.release}
        genAiService={host.genAi}
        onGenAiGenerationSucceeded={handleGeneratedResult}
        onGenAiOpenResult={handleOpenGeneratedResult}
        onGenAiOpenAsset={handleOpenGenAiAsset}
        hostKind={host.kind}
        recoveryNotice={recovery
          ? `${recovery.crashLoop ? 'Safe mode: ' : ''}Recovered copy of ${recovery.originalName}. Save creates a new file.`
          : null}
        onRecoveryResolved={recovery
          ? () => onRecoveryResolved(recovery.recoveryId)
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
        onExitApplication={onExitApplication}
        onRevealProject={onRevealProject}
        onRequestNewWorkspaceDocument={onRequestNew}
        onStartGuidedSample={onStartGuidedSample}
        onOpenSettings={onOpenSettings}
        onOpenStyleGuide={onOpenStyleGuide}
        onOpenWorkspaceDocument={onOpen}
        onDocumentReady={() => {
          if (document.kind !== 'image') return;
          if (document.session.getSnapshot().lifecycle !== 'ready') document.session.setReady();
          if (recovery && !document.session.getSnapshot().dirty) document.session.markChanged();
        }}
        onDocumentThumbnailChange={document.kind === 'image'
          ? (thumbnail) => onDocumentThumbnailChange(id, thumbnail)
          : undefined}
        onDirtyChange={(dirty) => {
          if (document.kind !== 'image') return;
          if (dirty) {
            document.session.markChanged();
          } else if (!recovery) {
            document.session.markSaved();
          }
        }}
        onClose={() => onClose(id)}
        onSave={document.kind === 'image'
          ? (output, recipe, transaction, replaceSource) => host.save({
              file: output,
              recipe,
              replaceSource,
              projectManifestPath: activeProject?.manifestPath,
              transaction
            })
          : () => Promise.reject(new Error('Video documents are read-only.'))}
        onExportFile={(file) => host.save({ file, recipe: null })}
      />
    </DocumentRuntimeErrorBoundary>
  );
}

const formatVideoTime = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
};
