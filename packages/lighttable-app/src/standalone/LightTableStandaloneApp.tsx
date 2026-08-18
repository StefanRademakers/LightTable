import { ButtonBase } from '../ui/ButtonBase';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { type DocumentSessionId } from '../lighttable/application/documents/documentSession';
import {
  createBrowserHost,
  type LightTableHost,
  type LightTableRecentFile,
  type LightTableProjectSummary,
  type LightTableRecentProject,
  type LightTableProjectLocation
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
  isSupportedImageFile
} from '../lighttable/image-io/supportedImageFormats';
import { createBlankPngFile } from './createBlankPngFile';
import { NewDocumentDialog } from './NewDocumentDialog';
import { LauncherJustifiedGallery } from './LauncherJustifiedGallery';
import { NewProjectDialog } from './NewProjectDialog';
import {
  LightTableCommandPortRegistry,
  LightTableCommandService
} from '../lighttable/application/commands/lightTableCommandService';
import type {
  LightTableRecoveryListing,
  LightTableRecoveryRecord
} from '../platform/LightTableRecoveryStore';
import { useReleaseSelectFocusAfterChange } from '../ui/useReleaseSelectFocusAfterChange';
import {
  GuidedSampleCoach,
  type GuidedSampleSession
} from './GuidedSampleCoach';
import { PreferencesDialog } from './PreferencesDialog';
import {
  DEFAULT_APPLICATION_PREFERENCES,
  loadApplicationPreferences,
  saveApplicationPreferences
} from './applicationPreferences';
import { ProjectHomeSurface } from './ProjectHomeSurface';
import { resolveWorkspaceSurface } from './workspaceSurface';
import type { GenAiAssetReference } from '@lighttable/genai-core';
import { duplicateLayeredDocumentArtifact } from '../lighttable/application/documents/duplicateLayeredDocumentArtifact';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
  /** Optional host contribution; omitted builds contain no UI inspection runtime. */
  onOpenStyleGuide?: () => void;
}

export const recentFilesForLauncher = (
  recentFiles: readonly LightTableRecentFile[]
): readonly LightTableRecentFile[] => recentFiles;

type LauncherPage = 'new-document' | 'recent-files' | 'recent-projects' | 'recovery-records';

const canUseSourceAsTabPreview = (file: File): boolean =>
  /^(image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp))$/i.test(file.type)
  || /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);

const RECOVERY_ATTEMPT_PREFIX = 'lighttable:recovery-attempt:';
const recoveryAttemptKey = (recoveryId: string) => `${RECOVERY_ATTEMPT_PREFIX}${recoveryId}`;
const hasRecoveryAttempt = (recoveryId: string): boolean => {
  try {
    return localStorage.getItem(recoveryAttemptKey(recoveryId)) !== null;
  } catch {
    return false;
  }
};
const markRecoveryAttempt = (recoveryId: string): void => {
  try { localStorage.setItem(recoveryAttemptKey(recoveryId), new Date().toISOString()); } catch { /* optional */ }
};
const clearRecoveryAttempt = (recoveryId: string): void => {
  try { localStorage.removeItem(recoveryAttemptKey(recoveryId)); } catch { /* optional */ }
};
const pickBrowserPlacedImage = () => new Promise<File | null>((resolve) => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
  let settled = false;
  const finish = (file: File | null) => { if (!settled) { settled = true; resolve(file); } };
  input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
  input.addEventListener('cancel', () => finish(null), { once: true });
  input.click();
});
const waitForReadyDocument = (session: import('../lighttable/application/documents/documentSession').DocumentSession) => new Promise<void>((resolve, reject) => {
  const inspect = () => {
    const state = session.getSnapshot();
    if (state.lifecycle === 'ready') { unsubscribe(); resolve(); }
    else if (state.lifecycle === 'failed' || state.lifecycle === 'disposed') {
      unsubscribe(); reject(new Error(state.lifecycleError ?? 'The document could not be decoded.'));
    }
  };
  const unsubscribe = session.subscribe(inspect);
  inspect();
});
export const newestRecoveryRecords = (
  listing: LightTableRecoveryListing
): readonly LightTableRecoveryRecord[] => {
  const seen = new Set<string>();
  return [...listing.records]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((record) => {
      if (seen.has(record.documentIdHash)) return false;
      seen.add(record.documentIdHash);
      return true;
    });
};

export const planRecoveryWorkspace = (
  listing: LightTableRecoveryListing,
  attempted: (recoveryId: string) => boolean
): { readonly records: readonly LightTableRecoveryRecord[]; readonly activeRecoveryId: string | null } => {
  const records = newestRecoveryRecords(listing)
    .filter((record) => !attempted(record.recoveryId))
    .sort((left, right) => (left.workspaceOrder ?? 0) - (right.workspaceOrder ?? 0));
  return {
    records,
    activeRecoveryId: records.find((record) => record.wasActive)?.recoveryId
      ?? records.at(-1)?.recoveryId
      ?? null
  };
};

/**
 * Host-neutral workspace shell.
 *
 * Each open document owns a mounted editor runtime. Inactive runtimes stay
 * mounted so their undo stack, selections, tools, layers and GPU document
 * remain isolated and intact while another tab is active.
 */
export function LightTableStandaloneApp({
  host = createBrowserHost(),
  onOpenStyleGuide
}: LightTableStandaloneAppProps) {
  useReleaseSelectFocusAfterChange();
  const {
    controller,
    snapshot,
    documents,
    openDocument,
    openRecoveredDocument,
    openDuplicatedDocument,
    closeDocument: closeWorkspaceDocument,
    activateDocument
  } = useStandaloneDocumentWorkspace(host.systemFontProvider);
  const [materializedDocumentIds, setMaterializedDocumentIds] = useState<ReadonlySet<DocumentSessionId>>(
    () => new Set()
  );
  useEffect(() => {
    const openIds = new Set(snapshot.documentOrder);
    setMaterializedDocumentIds((current) => {
      const next = new Set([...current].filter((id) => openIds.has(id)));
      if (snapshot.activeDocumentId) next.add(snapshot.activeDocumentId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [snapshot.activeDocumentId, snapshot.documentOrder]);
  const materializedDocuments = useMemo(
    () => documents.filter((document) => document.active || materializedDocumentIds.has(document.id)),
    [documents, materializedDocumentIds]
  );
  const commandPorts = useMemo(() => new LightTableCommandPortRegistry(), []);
  const commandService = useMemo(
    () => new LightTableCommandService(controller.workspace, commandPorts, {
      openArtifact: (file) => {
        const opened = openDocument(file);
        if (!opened.ok) throw new Error(`The artifact could not be opened: ${opened.error.code}.`);
        return opened.value.id;
      },
      createDocument: async (options) => {
        const file = await createBlankPngFile({
          width: options.width,
          height: options.height,
          resolutionPpi: options.resolutionPpi,
          name: `${options.name.replace(/\.png$/i, '')}.png`,
          backgroundColor: options.background.kind === 'solid' ? options.background.color : null
        });
        const opened = openDocument(file, 'automatic', {
          resolutionPpi: options.resolutionPpi,
          bitDepth: options.bitDepth,
          profile: options.profile
        });
        if (!opened.ok) throw new Error(`The document could not be created: ${opened.error.code}.`);
        try {
          await waitForReadyDocument(opened.value);
        } catch (reason) {
          controller.close(opened.value.id, { discardChanges: true });
          throw reason;
        }
        return opened.value.id;
      },
      duplicateDocument: async (documentId, name) => {
        const source = controller.getDocument(documentId);
        if (!source || source.getSnapshot().lifecycle !== 'ready') {
          throw new Error('The source document is not ready.');
        }
        const captured = await commandPorts.exportNativeArtifact(documentId);
        const artifact = await duplicateLayeredDocumentArtifact(captured, name);
        const opened = openDuplicatedDocument(artifact, name);
        if (!opened.ok) throw new Error(`The duplicate could not be opened: ${opened.error.code}.`);
        try {
          await waitForReadyDocument(opened.value);
        } catch (reason) {
          controller.close(opened.value.id, { discardChanges: true });
          throw reason;
        }
        return opened.value.id;
      }
    }),
    [commandPorts, controller, openDocument, openDuplicatedDocument]
  );
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [launcherPage, setLauncherPage] = useState<LauncherPage>('new-document');
  const launcherFileInputRef = useRef<HTMLInputElement>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => typeof localStorage === 'undefined'
    ? DEFAULT_APPLICATION_PREFERENCES
    : loadApplicationPreferences());
  useEffect(() => {
    void host.localAi?.configureProviders(preferences.genAi.providers).catch(() => undefined);
  }, [host.localAi, preferences.genAi.providers]);
  const [guidedSample, setGuidedSample] = useState<GuidedSampleSession | null>(null);
  const [recentFiles, setRecentFiles] = useState<readonly LightTableRecentFile[]>([]);
  const [activeProject, setActiveProject] = useState<LightTableProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<readonly LightTableRecentProject[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectLocation, setProjectLocation] = useState<LightTableProjectLocation | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectImporting, setProjectImporting] = useState(false);
  const [documentThumbnailUrls, setDocumentThumbnailUrls] = useState<Record<string, string>>({});
  const documentThumbnailUrlsRef = useRef(documentThumbnailUrls);
  documentThumbnailUrlsRef.current = documentThumbnailUrls;
  const [documentSourcePreviewUrls, setDocumentSourcePreviewUrls] = useState<Record<string, string>>({});
  const documentSourcePreviewUrlsRef = useRef(documentSourcePreviewUrls);
  documentSourcePreviewUrlsRef.current = documentSourcePreviewUrls;
  const publishDocumentThumbnail = useCallback((documentId: DocumentSessionId, thumbnail: Blob) => {
    const nextUrl = URL.createObjectURL(thumbnail);
    setDocumentThumbnailUrls((current) => {
      const previous = current[documentId];
      if (previous) URL.revokeObjectURL(previous);
      return { ...current, [documentId]: nextUrl };
    });
  }, []);
  useEffect(() => () => {
    Object.values(documentThumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    Object.values(documentSourcePreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    setDocumentSourcePreviewUrls((current) => {
      const openIds = new Set(documents.map(({ id }) => id));
      const next = { ...current };
      let changed = false;
      for (const [id, url] of Object.entries(current)) {
        if (openIds.has(id as DocumentSessionId)) continue;
        URL.revokeObjectURL(url);
        delete next[id];
        changed = true;
      }
      for (const document of documents) {
        if (next[document.id] || !canUseSourceAsTabPreview(document.runtime.file)) continue;
        next[document.id] = URL.createObjectURL(document.runtime.file);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [documents]);
  useEffect(() => {
    const openDocumentIds = new Set(documents.map(({ id }) => id));
    setDocumentThumbnailUrls((current) => {
      const stale = Object.keys(current).filter((id) => !openDocumentIds.has(id as DocumentSessionId));
      if (!stale.length) return current;
      const next = { ...current };
      for (const id of stale) {
        URL.revokeObjectURL(next[id]);
        delete next[id];
      }
      return next;
    });
  }, [documents]);
  const [recoveryListing, setRecoveryListing] = useState<LightTableRecoveryListing>({
    records: [],
    rejections: []
  });
  const [recoveryPreviews, setRecoveryPreviews] = useState<Record<string, string>>({});
  const recoveryPreviewsRef = useRef(recoveryPreviews);
  recoveryPreviewsRef.current = recoveryPreviews;
  const recoveryListingRef = useRef(recoveryListing);
  recoveryListingRef.current = recoveryListing;
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [screenMode, setScreenMode] = useState<EditorScreenMode>('normal');
  const launcherRecordedRef = useRef(false);
  const projectRestoreStartedRef = useRef(false);

  useEffect(() => () => commandService.dispose(), [commandService]);
  useEffect(() => host.installAutomationDriver?.(commandService), [commandService, host]);
  useEffect(() => host.agentAccess?.installDriver(commandService), [commandService, host.agentAccess]);
  useEffect(() => {
    if (snapshot.documentOrder.length > 0 || launcherRecordedRef.current) return;
    launcherRecordedRef.current = true;
    host.funnel?.record('launcher.viewed');
  }, [host, snapshot.documentOrder.length]);
  useEffect(() => {
    if (projectRestoreStartedRef.current) return;
    projectRestoreStartedRef.current = true;
    let cancelled = false;
    void host.listSystemFonts?.().then((fonts) => {
      if (!cancelled) controller.workspace.registerSystemFontReferences(fonts);
    }).catch(() => {
      // System fonts are optional; bundled/document fonts remain available.
    });
    return () => { cancelled = true; };
  }, [controller, host]);

  const refreshRecoveries = useCallback(async () => {
    if (!host.recovery) {
      setRecoveryListing({ records: [], rejections: [] });
      return;
    }
    try {
      const listing = await host.recovery.list();
      setRecoveryListing(listing);
      const validIds = new Set(listing.records.map(({ recoveryId }) => recoveryId));
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(RECOVERY_ATTEMPT_PREFIX)
          && !validIds.has(key.slice(RECOVERY_ATTEMPT_PREFIX.length))) {
          localStorage.removeItem(key);
        }
      }
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [host]);

  useEffect(() => {
    if (snapshot.documentOrder.length === 0) void refreshRecoveries();
  }, [refreshRecoveries, snapshot.documentOrder.length]);

  useEffect(() => () => {
    Object.values(recoveryPreviewsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

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
      setRecentFiles(await host.listRecentFiles());
    } catch {
      setRecentFiles([]);
    }
  }, [host]);

  const rememberDroppedFiles = useCallback((files: readonly File[]) => {
    if (!host.rememberRecentFiles) return;
    void host.rememberRecentFiles(files).then(refreshRecentFiles).catch(() => undefined);
  }, [host, refreshRecentFiles]);
  const projectHomeActive = Boolean(activeProject && snapshot.documentOrder.length === 0);
  const fileDrop = useStandaloneFileDrop(
    openDocument,
    rememberDroppedFiles,
    !projectHomeActive
  );

  const importProjectFiles = useCallback(async (files: readonly File[]) => {
    if (!activeProject || !host.genAi || projectImporting) return;
    const supported = files.filter((file) => isSupportedImageFile(file, file.name, 'automatic'));
    if (!supported.length) {
      setProjectError('Unsupported media. No project files were changed.');
      return;
    }
    setProjectImporting(true);
    setProjectError(null);
    try {
      for (const file of supported) {
        await host.genAi.importProjectAsset(activeProject.id, {
          name: file.name,
          mediaType: file.type || 'application/octet-stream',
          bytes: new Uint8Array(await file.arrayBuffer())
        });
      }
      await host.genAi.refreshProjectAssets(activeProject.id);
      if (supported.length !== files.length) {
        setProjectError(
          `Imported ${supported.length} supported file${supported.length === 1 ? '' : 's'}; `
          + `${files.length - supported.length} unsupported file${files.length - supported.length === 1 ? '' : 's'} skipped.`
        );
      }
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProjectImporting(false);
    }
  }, [activeProject, host.genAi, projectImporting]);

  const openProjectAsset = useCallback(async (asset: GenAiAssetReference) => {
    if (!activeProject || !host.genAi) return;
    setOpening(true);
    try {
      const payload = await host.genAi.loadProjectAsset(activeProject.id, asset.id);
      if (!payload) throw new Error(`${asset.label} is no longer available.`);
      openDocument(new File([Uint8Array.from(payload.bytes).buffer], payload.name, { type: payload.mediaType }));
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  }, [activeProject, host.genAi, openDocument]);

  const refreshRecentProjects = useCallback(async () => {
    try {
      setRecentProjects(await host.projects?.listRecent() ?? []);
    } catch {
      setRecentProjects([]);
    }
  }, [host.projects]);

  const requestNewProject = useCallback(() => {
    setProjectError(null);
    setNewProjectOpen(true);
  }, []);

  const chooseProjectLocation = useCallback(async () => {
    try {
      const selected = await host.projects?.chooseParentLocation() ?? null;
      if (selected) setProjectLocation(selected);
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [host.projects]);

  const createProject = useCallback(async (name: string) => {
    if (!host.projects || !projectLocation) return;
    setProjectCreating(true);
    setProjectError(null);
    try {
      setActiveProject(await host.projects.create({
        name,
        parentPath: projectLocation.path,
        folders: preferences.projects.folders,
        createFolders: preferences.projects.createFolders,
        userFolders: preferences.projects.userFolders
      }));
      setNewProjectOpen(false);
      await refreshRecentProjects();
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProjectCreating(false);
    }
  }, [host.projects, preferences.projects.createFolders, preferences.projects.folders, preferences.projects.userFolders, projectLocation, refreshRecentProjects]);

  const openProject = useCallback(async () => {
    setProjectError(null);
    setOpening(true);
    try {
      const project = await host.projects?.open() ?? null;
      if (project) {
        setActiveProject(project);
        const file = project.lastUsedDocument
          ? await host.projects?.openLastUsedDocument(project) ?? null
          : null;
        if (file) openDocument(file);
        await refreshRecentProjects();
      }
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  }, [host.projects, openDocument, refreshRecentProjects]);

  const openRecentProject = useCallback(async (recentId: string) => {
    setProjectError(null);
    setOpening(true);
    try {
      const project = await host.projects?.openRecent(recentId) ?? null;
      if (project) {
        setActiveProject(project);
        const file = project.lastUsedDocument
          ? await host.projects?.openLastUsedDocument(project) ?? null
          : null;
        if (file) openDocument(file);
      }
      await refreshRecentProjects();
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  }, [host.projects, openDocument, refreshRecentProjects]);

  const clearRecentProjects = useCallback(async () => {
    await host.projects?.clearRecent();
    await refreshRecentProjects();
  }, [host.projects, refreshRecentProjects]);

  useEffect(() => {
    if (snapshot.documentOrder.length === 0) {
      void refreshRecentFiles();
      void refreshRecentProjects();
    }
  }, [refreshRecentFiles, refreshRecentProjects, snapshot.documentOrder.length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const project = await host.projects?.current() ?? null;
        if (!cancelled) setActiveProject(project);
        if (project?.lastUsedDocument && !cancelled && snapshot.documentOrder.length === 0) {
          const file = await host.projects?.openLastUsedDocument(project) ?? null;
          if (cancelled) return;
          if (file) openDocument(file);
          else setProjectError(
            `${project.lastUsedDocument.name} is unavailable. The project opened in Project Home.`
          );
        }
      } catch (reason) {
        if (!cancelled) {
          setActiveProject(null);
          setProjectError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (!cancelled) await refreshRecentProjects();
    })();
    return () => { cancelled = true; };
  }, [host.projects, openDocument, refreshRecentProjects, snapshot.documentOrder.length]);

  const requestHostDocument = useCallback(async (
    decodeMode: StandaloneDecodeMode = 'automatic'
  ) => {
    if (!host.openFile) return;
    setOpening(true);
    try {
      const file = await host.openFile();
      if (file) {
        openDocument(file, decodeMode);
        await refreshRecentFiles();
      }
    } finally {
      setOpening(false);
    }
  }, [host, openDocument, refreshRecentFiles]);

  const openRecentDocument = useCallback(async (id: string) => {
    if (!host.openRecentFile) return;
    setOpening(true);
    try {
      const file = await host.openRecentFile(id);
      if (file) openDocument(file);
      await refreshRecentFiles();
    } finally {
      setOpening(false);
    }
  }, [host, openDocument, refreshRecentFiles]);

  const clearRecentFiles = useCallback(async () => {
    await host.clearRecentFiles?.();
    await refreshRecentFiles();
  }, [host, refreshRecentFiles]);

  const removeRecentFile = useCallback(async (id: string) => {
    await host.removeRecentFile?.(id);
    await refreshRecentFiles();
  }, [host, refreshRecentFiles]);

  const createDocument = useCallback(async (options: import('../lighttable/application/commands/lightTableCommandService').LightTableCreateDocumentOptions) => {
    setCreating(true);
    try {
      const result = await commandService.execute({
        protocolVersion: 1,
        requestId: `ui-new-${crypto.randomUUID()}`,
        command: 'document.create',
        parameters: {
          ...options
        }
      });
      if (result.status === 'completed') setNewDialogOpen(false);
      return result;
    } finally {
      setCreating(false);
    }
  }, [commandService]);

  const startGuidedSample = useCallback(async () => {
    host.funnel?.record('guide.started');
    const result = await createDocument({
      name: 'LightTable guided sample',
      width: 960,
      height: 640,
      resolutionPpi: 72,
      bitDepth: 8,
      profile: 'srgb',
      background: { kind: 'solid', color: '#f3f5f8' }
    });
    if (result?.status !== 'completed') return;
    const documentId = (result.value as { documentId?: DocumentSessionId }).documentId;
    if (!documentId || commandService.queryDocument(documentId)?.lifecycle !== 'ready') return;
    host.funnel?.record('guide.sample-ready');
    setGuidedSample({ documentId, step: 'shape' });
  }, [commandService, createDocument, host]);

  const requestNewDocument = useCallback(() => setNewDialogOpen(true), []);

  const requestPlaceArtifact = useCallback(async (documentId: DocumentSessionId) => {
    const file = await (host.openFile?.() ?? pickBrowserPlacedImage());
    if (!file) return;
    const artifact = commandService.registerInputArtifact(file);
    await commandService.execute({
      protocolVersion: 1,
      requestId: `ui-place-${crypto.randomUUID()}`,
      command: 'layer.placeArtifact',
      documentId,
      parameters: { artifactId: artifact.id }
    });
  }, [commandService, host]);

  const openRecovery = useCallback(async (record: LightTableRecoveryRecord) => {
    if (!host.recovery) return null;
    setOpening(true);
    setRecoveryError(null);
    try {
      const entry = await host.recovery.read(record.recoveryId);
      if (!entry) throw new Error('The recovery snapshot is missing or failed validation.');
      const originalName = record.sourceName || 'Recovered document';
      const base = originalName.replace(/\.[^.]+$/, '') || 'Recovered document';
      const file = new File(
        [entry.artifact],
        `${base}-recovered-lighttable.png`,
        { type: entry.record.mediaType || 'image/png' }
      );
      const crashLoop = hasRecoveryAttempt(record.recoveryId);
      markRecoveryAttempt(record.recoveryId);
      const opened = openRecoveredDocument(file, record, crashLoop);
      if (!opened.ok) {
        clearRecoveryAttempt(record.recoveryId);
        throw new Error(`Recovered work could not be opened: ${opened.error.code}.`);
      }
      return opened.value.id;
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setOpening(false);
    }
  }, [host, openRecoveredDocument]);

  const previewRecovery = useCallback(async (record: LightTableRecoveryRecord) => {
    if (!host.recovery) return null;
    if (recoveryPreviews[record.recoveryId]) return recoveryPreviews[record.recoveryId];
    setRecoveryError(null);
    try {
      const entry = await host.recovery.read(record.recoveryId);
      if (!entry) throw new Error('The recovery preview is missing or corrupt.');
      if (!recoveryListingRef.current.records.some(({ recoveryId }) => recoveryId === record.recoveryId)) {
        return null;
      }
      const url = URL.createObjectURL(entry.artifact);
      setRecoveryPreviews((current) => ({ ...current, [record.recoveryId]: url }));
      return url;
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [host, recoveryPreviews]);

  const resolveRecovery = useCallback(async (recoveryId: string) => {
    await host.recovery?.removeRecord(recoveryId);
    clearRecoveryAttempt(recoveryId);
    setRecoveryPreviews((current) => {
      const preview = current[recoveryId];
      if (!preview) return current;
      URL.revokeObjectURL(preview);
      const next = { ...current };
      delete next[recoveryId];
      return next;
    });
    await refreshRecoveries();
  }, [host, refreshRecoveries]);

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'n' && key !== 'k') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === 'n') requestNewDocument();
      else setSettingsOpen(true);
    };
    window.addEventListener('keydown', handleApplicationShortcut, true);
    return () => window.removeEventListener('keydown', handleApplicationShortcut, true);
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

  const browseProjectImport = useCallback(async () => {
    const file = await host.openFile?.();
    if (file) await importProjectFiles([file]);
  }, [host, importProjectFiles]);

  const workspaceDocuments = useMemo(
    () => documents.map(({ id, title, dirty }) => ({
      id, title, dirty, thumbnailUrl: documentThumbnailUrls[id] ?? documentSourcePreviewUrls[id]
    })),
    [documentSourcePreviewUrls, documentThumbnailUrls, documents]
  );

  const activeLifecycle = snapshot.activeDocumentId
    ? snapshot.documents[snapshot.activeDocumentId]?.lifecycle ?? null
    : null;
  const workspaceSurface = resolveWorkspaceSurface({
    projectId: activeProject?.id ?? null,
    activeDocumentId: snapshot.activeDocumentId,
    lifecycle: activeLifecycle
  });

  if (workspaceSurface.kind === 'project-home' && activeProject) {
    return <>
      <ProjectHomeSurface
        project={activeProject}
        service={host.genAi}
        surface={workspaceSurface}
        importing={projectImporting}
        error={projectError}
        onBrowse={() => void browseProjectImport()}
        onNewDocument={requestNewDocument}
        onOpenFile={() => void requestHostDocument()}
        onOpenAsset={(asset) => void openProjectAsset(asset)}
        onImportFiles={(files) => void importProjectFiles(files)}
        onCloseProject={() => {
          void host.projects?.close();
          setActiveProject(null);
        }}
        onRevealProject={() => void host.projects?.reveal(activeProject)}
      />
      <NewDocumentDialog open={newDialogOpen} clipboard={host.clipboard} creating={creating}
        onCancel={() => setNewDialogOpen(false)} onCreate={(size) => void createDocument(size)} />
      <NewProjectDialog open={newProjectOpen} creating={projectCreating}
        location={projectLocation} error={projectError}
        onChooseLocation={() => void chooseProjectLocation()}
        onCancel={() => setNewProjectOpen(false)}
        onCreate={(name) => void createProject(name)} />
      <PreferencesDialog open={settingsOpen} host={host} preferences={preferences}
        onCancel={() => setSettingsOpen(false)} onSave={(next) => {
          saveApplicationPreferences(next);
          setPreferences(next);
          setSettingsOpen(false);
        }} />
    </>;
  }

  if (workspaceSurface.kind === 'launcher') {
    const recoverableRecords = newestRecoveryRecords(recoveryListing);
    const pageTitle: Record<LauncherPage, string> = {
      'new-document': 'New Document',
      'recent-files': 'Recent Files',
      'recent-projects': 'Recent Projects',
      'recovery-records': 'Recovery Records'
    };
    return (
      <main className={`lighttable-launcher${fileDrop.active ? ' lighttable-launcher--drop-active' : ''}`}>
        <input ref={launcherFileInputRef} type="file" accept={imagePickerAccept('automatic')} hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = '';
            if (file) openDocument(file);
          }} />
        <div className="lighttable-launcher__workspace">
          <nav className="lighttable-preferences__navigation lighttable-launcher__navigation" aria-label="Start">
            <ButtonBase type="button" disabled={opening} onClick={() => {
              if (host.openFile) void requestHostDocument();
              else launcherFileInputRef.current?.click();
            }}>Open</ButtonBase>
            <ButtonBase type="button" disabled={projectCreating || !host.projects}
              onClick={requestNewProject}>New Project</ButtonBase>
            <ButtonBase type="button" disabled={opening || !host.projects}
              onClick={() => void openProject()}>Open Project</ButtonBase>
            <ButtonBase type="button" className={launcherPage === 'new-document' ? 'is-active' : undefined}
              aria-current={launcherPage === 'new-document' ? 'page' : undefined}
              onClick={() => setLauncherPage('new-document')}>New Document</ButtonBase>
            <ButtonBase type="button" className={launcherPage === 'recent-files' ? 'is-active' : undefined}
              aria-current={launcherPage === 'recent-files' ? 'page' : undefined}
              onClick={() => setLauncherPage('recent-files')}>Recent Files</ButtonBase>
            <ButtonBase type="button" className={launcherPage === 'recent-projects' ? 'is-active' : undefined}
              aria-current={launcherPage === 'recent-projects' ? 'page' : undefined}
              onClick={() => setLauncherPage('recent-projects')}>Recent Projects</ButtonBase>
            <ButtonBase type="button" className={launcherPage === 'recovery-records' ? 'is-active' : undefined}
              aria-current={launcherPage === 'recovery-records' ? 'page' : undefined}
              onClick={() => setLauncherPage('recovery-records')}>
              Recovery Records
              {recoverableRecords.length ? <span>{recoverableRecords.length}</span> : null}
            </ButtonBase>
          </nav>
          <section className="lighttable-launcher__view" aria-labelledby="launcher-view-title">
            <header className="lighttable-launcher__view-header">
              <h1 id="launcher-view-title">{pageTitle[launcherPage]}</h1>
            </header>
            <div className="lighttable-launcher__view-scroll">
              {launcherPage === 'new-document' ? (
                <div className="lighttable-launcher__new-document">
                  <NewDocumentDialog open presentation="embedded" clipboard={host.clipboard}
                    creating={creating} onCancel={() => undefined}
                    onCreate={(options) => void createDocument(options)} />
                </div>
              ) : launcherPage === 'recent-files' ? (
                recentFiles.length ? <LauncherJustifiedGallery opening={opening}
                  items={recentFilesForLauncher(recentFiles).map((recent) => ({
                    id: recent.id, title: recent.name, available: recent.available,
                    previewUrl: recent.thumbnailUrl,
                    loadPreview: host.loadRecentFileThumbnail ? () => host.loadRecentFileThumbnail!(recent.id) : undefined,
                    onOpen: () => void openRecentDocument(recent.id),
                    onReveal: host.revealRecentFile ? () => void host.revealRecentFile!(recent.id) : undefined,
                    onRemove: host.removeRecentFile ? () => void removeRecentFile(recent.id) : undefined
                  }))} /> : <p className="lighttable-launcher__empty">No recent files.</p>
              ) : launcherPage === 'recent-projects' ? (
                recentProjects.length ? <LauncherJustifiedGallery opening={opening}
                  items={recentProjects.map((project) => ({
                    id: project.recentId, title: project.name,
                    subtitle: project.lastUsedDocument?.name ?? project.rootPath,
                    loadPreview: host.projects?.loadRecentThumbnail
                      ? () => host.projects!.loadRecentThumbnail(project.recentId)
                      : undefined,
                    available: project.available, onOpen: () => void openRecentProject(project.recentId),
                    onRemove: host.projects ? () => void host.projects?.removeRecent(project.recentId).then(refreshRecentProjects) : undefined
                  }))} /> : <p className="lighttable-launcher__empty">No recent projects.</p>
              ) : (
                <>
                  {recoveryListing.rejections.length ? <p className="lighttable-launcher__warning" role="alert">
                    {recoveryListing.rejections.length} recovery record(s) were isolated because they are unreadable or unsupported.
                  </p> : null}
                  {recoveryError ? <p className="lighttable-launcher__warning" role="alert">{recoveryError}</p> : null}
                  {!host.recovery ? <p className="lighttable-launcher__empty">Recovery records are unavailable in this environment.</p>
                    : recoverableRecords.length ? <LauncherJustifiedGallery opening={opening}
                      items={recoverableRecords.map((record) => ({
                        id: record.recoveryId, title: record.sourceName || 'Recovered document',
                        subtitle: `Last edit ${new Date(record.updatedAt).toLocaleString()}`,
                        available: true, previewUrl: recoveryPreviews[record.recoveryId],
                        loadPreview: () => previewRecovery(record), onOpen: () => void openRecovery(record)
                      }))} /> : <p className="lighttable-launcher__empty">No recovery records.</p>}
                </>
              )}
              {fileDrop.error ? <p className="lighttable-launcher__warning" role="alert">{fileDrop.error}</p> : null}
            </div>
          </section>
        </div>
        <NewProjectDialog open={newProjectOpen} creating={projectCreating}
          location={projectLocation} error={projectError}
          onChooseLocation={() => void chooseProjectLocation()}
          onCancel={() => setNewProjectOpen(false)}
          onCreate={(name) => void createProject(name)} />
        <PreferencesDialog open={settingsOpen} host={host} preferences={preferences}
          onCancel={() => setSettingsOpen(false)} onSave={(next) => {
            saveApplicationPreferences(next);
            setPreferences(next);
            setSettingsOpen(false);
          }} />
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
        <ButtonBase
          className="lighttable-file-drop__notice"
          type="button"
          role="alert"
          onClick={fileDrop.clearError}
        >
          {fileDrop.error}
        </ButtonBase>
      ) : null}
      {projectError && !newProjectOpen ? (
        <ButtonBase
          className="lighttable-file-drop__notice"
          type="button"
          role="alert"
          onClick={() => setProjectError(null)}
        >
          {projectError}
        </ButtonBase>
      ) : null}
      {materializedDocuments.map((document) => (
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
          onRequestPlace={requestPlaceArtifact}
          recentFiles={recentFiles}
          onOpenRecent={openRecentDocument}
          onClearRecent={clearRecentFiles}
          activeProject={activeProject}
          recentProjects={recentProjects}
          onRequestNewProject={requestNewProject}
          onRequestOpenProject={() => void openProject()}
          onOpenRecentProject={(recentId) => void openRecentProject(recentId)}
          onClearRecentProjects={() => void clearRecentProjects()}
          onCloseProject={() => {
            void host.projects?.close();
            setActiveProject(null);
          }}
          onRevealProject={() => {
            if (activeProject) void host.projects?.reveal(activeProject);
          }}
          onRequestNew={requestNewDocument}
          onStartGuidedSample={() => void startGuidedSample()}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStyleGuide={onOpenStyleGuide}
          preferences={preferences}
          onOpen={openDocument}
          onRecoveryResolved={(recoveryId) => void resolveRecovery(recoveryId)}
          onDocumentThumbnailChange={publishDocumentThumbnail}
        />
      ))}
      <NewDocumentDialog
        open={newDialogOpen}
        clipboard={host.clipboard}
        creating={creating}
        onCancel={() => setNewDialogOpen(false)}
        onCreate={(size) => void createDocument(size)}
      />
      <NewProjectDialog open={newProjectOpen} creating={projectCreating}
        location={projectLocation} error={projectError}
        onChooseLocation={() => void chooseProjectLocation()}
        onCancel={() => setNewProjectOpen(false)}
        onCreate={(name) => void createProject(name)} />
      <PreferencesDialog open={settingsOpen} host={host} preferences={preferences}
        onCancel={() => setSettingsOpen(false)} onSave={(next) => {
          saveApplicationPreferences(next);
          setPreferences(next);
          setSettingsOpen(false);
        }} />
      {guidedSample ? (
        <GuidedSampleCoach
          session={guidedSample}
          ready={snapshot.documents[guidedSample.documentId]?.lifecycle === 'ready'
            && commandPorts.has(guidedSample.documentId)}
          service={commandService}
          host={host}
          onSession={setGuidedSample}
          onDismiss={() => setGuidedSample(null)}
        />
      ) : null}
    </>
  );
}
