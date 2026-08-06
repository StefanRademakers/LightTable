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
import type {
  LightTableRecoveryListing,
  LightTableRecoveryRecord
} from '../platform/LightTableRecoveryStore';
import { AboutUpdateDialog } from '../lighttable/editor/ui/AboutUpdateDialog';
import {
  GuidedSampleCoach,
  type GuidedSampleSession
} from './GuidedSampleCoach';
import { AgentAccessSettingsDialog } from './AgentAccessSettingsDialog';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
}

export const recentFilesForLauncher = (
  recentFiles: readonly LightTableRecentFile[]
): readonly LightTableRecentFile[] => recentFiles.slice(0, 15);

const RecentFileCard = ({
  recent,
  opening,
  loadThumbnail,
  onOpen,
  onRemove
}: {
  readonly recent: LightTableRecentFile;
  readonly opening: boolean;
  readonly loadThumbnail?: (id: string) => Promise<string | null>;
  readonly onOpen: (id: string) => void;
  readonly onRemove?: (id: string) => void;
}) => {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [thumbnail, setThumbnail] = useState(recent.thumbnailUrl);

  useEffect(() => {
    setThumbnail(recent.thumbnailUrl);
    if (recent.thumbnailUrl || !recent.available || !loadThumbnail) return undefined;
    const target = previewRef.current;
    if (!target) return undefined;
    let active = true;
    const load = () => {
      void loadThumbnail(recent.id).then((url) => {
        if (active && url) setThumbnail(url);
      }).catch(() => undefined);
    };
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '120px' });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
  }, [loadThumbnail, recent.available, recent.id, recent.thumbnailUrl]);

  return (
    <article className={`lighttable-launcher__recent${recent.available ? '' : ' lighttable-launcher__recent--missing'}`}>
      <button type="button" disabled={opening} onClick={() => onOpen(recent.id)}>
        <span ref={previewRef} className="lighttable-launcher__recent-preview">
          {thumbnail
            ? <img src={thumbnail} alt="" />
            : <span>{recent.available ? 'No preview' : 'File missing'}</span>}
        </span>
        <span className="lighttable-launcher__recent-name" title={recent.name}>{recent.name}</span>
      </button>
      {!recent.available && onRemove ? (
        <button
          className="lighttable-launcher__recent-remove"
          type="button"
          aria-label={`Remove missing recent file ${recent.name}`}
          title="Remove missing recent file"
          onClick={() => onRemove(recent.id)}
        >Remove</button>
      ) : null}
    </article>
  );
};

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
  host = createBrowserHost()
}: LightTableStandaloneAppProps) {
  const {
    controller,
    snapshot,
    documents,
    openDocument,
    openRecoveredDocument,
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
      }
    }),
    [commandPorts, controller, openDocument]
  );
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guidedSample, setGuidedSample] = useState<GuidedSampleSession | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(() => host.funnel?.enabled() ?? false);
  const [recentFiles, setRecentFiles] = useState<readonly LightTableRecentFile[]>([]);
  const [recoveryListing, setRecoveryListing] = useState<LightTableRecoveryListing>({
    records: [],
    rejections: []
  });
  const [recoveryPreviews, setRecoveryPreviews] = useState<Record<string, string>>({});
  const recoveryPreviewsRef = useRef(recoveryPreviews);
  recoveryPreviewsRef.current = recoveryPreviews;
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveriesDeferred, setRecoveriesDeferred] = useState(false);
  const [screenMode, setScreenMode] = useState<EditorScreenMode>('normal');
  const fileDrop = useStandaloneFileDrop(openDocument);
  const launcherRecordedRef = useRef(false);

  useEffect(() => () => commandService.dispose(), [commandService]);
  useEffect(() => host.installAutomationDriver?.(commandService), [commandService, host]);
  useEffect(() => host.agentAccess?.installDriver(commandService), [commandService, host.agentAccess]);
  useEffect(() => {
    if (snapshot.documentOrder.length > 0 || launcherRecordedRef.current) return;
    launcherRecordedRef.current = true;
    host.funnel?.record('launcher.viewed');
  }, [host, snapshot.documentOrder.length]);
  useEffect(() => {
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
      setRecentFiles((await host.listRecentFiles()).slice(0, 15));
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
    if (!host.recovery || recoveryPreviews[record.recoveryId]) return;
    setRecoveryError(null);
    try {
      const entry = await host.recovery.read(record.recoveryId);
      if (!entry) throw new Error('The recovery preview is missing or corrupt.');
      const url = URL.createObjectURL(entry.artifact);
      setRecoveryPreviews((current) => ({ ...current, [record.recoveryId]: url }));
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [host, recoveryPreviews]);

  const discardRecovery = useCallback(async (record: LightTableRecoveryRecord) => {
    if (!host.recovery) return;
    await host.recovery.removeRecord(record.recoveryId);
    clearRecoveryAttempt(record.recoveryId);
    const preview = recoveryPreviews[record.recoveryId];
    if (preview) URL.revokeObjectURL(preview);
    setRecoveryPreviews((current) => {
      const next = { ...current };
      delete next[record.recoveryId];
      return next;
    });
    await refreshRecoveries();
  }, [host, recoveryPreviews, refreshRecoveries]);

  const resolveRecovery = useCallback(async (recoveryId: string) => {
    await host.recovery?.removeRecord(recoveryId);
    clearRecoveryAttempt(recoveryId);
    await refreshRecoveries();
  }, [host, refreshRecoveries]);

  const recoverAll = useCallback(async () => {
    const plan = planRecoveryWorkspace(recoveryListing, hasRecoveryAttempt);
    let requestedActive: DocumentSessionId | null = null;
    let lastOpened: DocumentSessionId | null = null;
    for (const record of plan.records) {
      const openedId = await openRecovery(record);
      if (!openedId) continue;
      lastOpened = openedId;
      if (record.recoveryId === plan.activeRecoveryId) requestedActive = openedId;
    }
    if (requestedActive ?? lastOpened) activateDocument((requestedActive ?? lastOpened)!);
  }, [activateDocument, openRecovery, recoveryListing]);

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
    const recoverableRecords = recoveriesDeferred
      ? []
      : newestRecoveryRecords(recoveryListing);
    return (
      <main
        className={`lighttable-launcher${fileDrop.active ? ' lighttable-launcher--drop-active' : ''}`}
      >
        <div className="lighttable-launcher__content">
          {recoverableRecords.length > 0 ? (
            <section className="lighttable-launcher__recovery-section" aria-labelledby="recoverable-work-heading">
              <div className="lighttable-launcher__recovery-heading">
                <div>
                  <h2 id="recoverable-work-heading">Recoverable work</h2>
                  <p>Recovered copies never overwrite their original source.</p>
                </div>
                <div className="lighttable-launcher__recovery-actions">
                  {recoverableRecords.length > 1 ? (
                    <button className="action-button" type="button" disabled={opening} onClick={() => void recoverAll()}>
                      Open all
                    </button>
                  ) : null}
                  <button className="action-button" type="button" onClick={() => setRecoveriesDeferred(true)}>
                    Later
                  </button>
                </div>
              </div>
              <div className="lighttable-launcher__recoveries">
                {recoverableRecords.map((record) => {
                  const crashLoop = hasRecoveryAttempt(record.recoveryId);
                  const preview = recoveryPreviews[record.recoveryId];
                  return (
                    <article className="lighttable-launcher__card lighttable-launcher__recovery-card" key={record.recoveryId}>
                      <div className="lighttable-launcher__recovery-preview">
                        {preview ? <img src={preview} alt={`Preview of ${record.sourceName || 'recovered work'}`} /> : <span>No preview loaded</span>}
                      </div>
                      <div className="lighttable-launcher__recovery-copy">
                        <h3>{record.sourceName || 'Recovered document'}</h3>
                        <p>{record.sourcePath || 'Original source location is unavailable.'}</p>
                        {record.sourceAvailability === 'missing' ? (
                          <p className="lighttable-launcher__recovery-warning" role="status">
                            The original source is missing or moved. This recovered copy remains available.
                          </p>
                        ) : null}
                        {record.sourceAvailability === 'newer' ? (
                          <p className="lighttable-launcher__recovery-warning" role="status">
                            The original source is newer. Recovery opens as a separate copy.
                          </p>
                        ) : null}
                        <p>{record.sourceMediaType || record.mediaType} · revision {record.canonicalRevision}</p>
                        <p>Last edit {new Date(record.updatedAt).toLocaleString()}</p>
                        {crashLoop ? (
                          <p className="lighttable-launcher__recovery-warning" role="alert">
                            This copy was open when LightTable stopped. It will retry in isolated safe mode.
                          </p>
                        ) : null}
                        <div className="lighttable-launcher__recovery-actions">
                          <button className="action-button" type="button" disabled={opening} onClick={() => void openRecovery(record)}>
                            {crashLoop ? 'Retry recovered copy' : 'Open recovered copy'}
                          </button>
                          <button className="action-button" type="button" onClick={() => void previewRecovery(record)}>
                            Preview
                          </button>
                          <button className="action-button" type="button" onClick={() => void discardRecovery(record)}>
                            Discard
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          {recoveryListing.rejections.length > 0 ? (
            <p className="lighttable-file-drop__error" role="alert">
              {recoveryListing.rejections.length} recovery record(s) were isolated because they are unreadable or from an unsupported version.
            </p>
          ) : null}
          {recoveryError ? <p className="lighttable-file-drop__error" role="alert">{recoveryError}</p> : null}
          {!host.recovery ? (
            <p className="lighttable-launcher__recovery-unavailable" role="status">
              Durable crash recovery is unavailable in this environment.
            </p>
          ) : null}
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
              <button className="lighttable-launcher__guide-action" type="button" disabled={creating}
                onClick={() => void startGuidedSample()}>
                {creating ? 'Preparing...' : 'Try a guided layered edit'}
              </button>
            </section>
          </div>

          <section className="lighttable-launcher__local-first" aria-label="Local-first editing">
            <strong>Your files stay local.</strong>
            <span>Open PNG, JPEG, WebP, TIFF, PSD/PSB and PDF. Unsupported document features are preserved with a preview and reported before export.</span>
            {host.funnel ? (
              <label><input type="checkbox" checked={telemetryEnabled} onChange={(event) => {
                const enabled = event.currentTarget.checked;
                host.funnel?.setEnabled(enabled);
                if (enabled) host.funnel?.record('launcher.viewed');
                setTelemetryEnabled(enabled);
              }} /> Store anonymous onboarding progress on this device</label>
            ) : null}
          </section>

          {recentFiles.length > 0 ? (
            <section className="lighttable-launcher__recent-section">
              <h2>Recent files</h2>
              <div className="lighttable-launcher__recents">
                {recentFilesForLauncher(recentFiles).map((recent) => (
                  <RecentFileCard
                    key={recent.id}
                    recent={recent}
                    opening={opening}
                    loadThumbnail={host.loadRecentFileThumbnail}
                    onOpen={(id) => void openRecentDocument(id)}
                    onRemove={host.removeRecentFile ? (id) => void removeRecentFile(id) : undefined}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <div className="lighttable-launcher__utility-actions">
            <button className="action-button" type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
            <button className="action-button" type="button" onClick={() => setAboutOpen(true)}>About LightTable</button>
          </div>
        </div>
        <NewDocumentDialog
          open={newDialogOpen}
          clipboard={host.clipboard}
          creating={creating}
          onCancel={() => setNewDialogOpen(false)}
          onCreate={(size) => void createDocument(size)}
        />
        <AboutUpdateDialog
          open={aboutOpen}
          release={host.release}
          dirtyDocuments={false}
          onClose={() => setAboutOpen(false)}
        />
        <AgentAccessSettingsDialog open={settingsOpen} service={host.agentAccess} onClose={() => setSettingsOpen(false)} />
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
          onRequestPlace={requestPlaceArtifact}
          recentFiles={recentFiles}
          onOpenRecent={openRecentDocument}
          onClearRecent={clearRecentFiles}
          onRequestNew={requestNewDocument}
          onStartGuidedSample={() => void startGuidedSample()}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpen={openDocument}
          onRecoveryResolved={(recoveryId) => void resolveRecovery(recoveryId)}
        />
      ))}
      <NewDocumentDialog
        open={newDialogOpen}
        clipboard={host.clipboard}
        creating={creating}
        onCancel={() => setNewDialogOpen(false)}
        onCreate={(size) => void createDocument(size)}
      />
      <AgentAccessSettingsDialog open={settingsOpen} service={host.agentAccess} onClose={() => setSettingsOpen(false)} />
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
