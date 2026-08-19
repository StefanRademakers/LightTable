import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  session,
  shell
} from 'electron';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopSavePayload } from './desktopBridge';
import { atomicWriteFile, AtomicWriteError } from './atomicFileWriter';
import {
  activateProjectAssetCatalog,
  deactivateProjectAssetCatalog,
  readProjectAsset,
  readProjectAssetDirectories,
  readProjectAssetIndex,
  readProjectAssetPreview,
  rebuildProjectAssetIndex,
  recordSavedProjectAsset,
  renameProjectAsset,
  resolveProjectAssetPath,
  scheduleSavedProjectAsset,
  subscribeProjectAssetCatalog
} from './projectAssetService';
import { DesktopRecoveryStore } from './recoveryStore';
import {
  createDesktopOpenDialogFilters,
  desktopMediaTypeForFileName
} from './desktopFileFormats';
import {
  canonicalRecentFilePath,
  normalizeRecentFiles,
  RecentFileOperationQueue,
  touchRecentFile,
  type PersistedRecentFile
} from './recentFiles';
import {
  createProjectOnDisk,
  openProjectManifest,
  resolveProjectStoragePath,
  setProjectLastUsedDocument,
  type DesktopProjectSummary
} from './projectService';
import { WindowsSystemFontCatalog } from './systemFonts';
import {
  releaseChannelFor,
  fetchUpdateManifest,
  verifyUpdateArtifact,
  verifyUpdateManifest,
  type SignedUpdateManifest
} from './releaseUpdate';
import type { LightTableUpdateResult } from '@lighttable/app';
import { BoundedLruCache } from './boundedLruCache';
import { AgentAccessBridge } from './agentAccessBridge';
import { DesktopAgentAccessCredentialStore } from './agentAccessCredentialStore';
import { AgentTunnelController, createAgentDeviceId } from './agentTunnel';
import {
  HttpsAgentPairingClient,
  ProtectedAgentTunnelSessionStore,
  WebSocketAgentTunnelTransport
} from './agentTunnelAdapters';
import { loadRendererUrlWithRetry } from './rendererNavigation';
import { DesktopOpenArtCredentialStore } from './genai/openArtCredentialStore';
import { abortableDelay } from './genai/abortableDelay';
import { createLoopbackOAuthSession } from './genai/loopbackOAuthSession';
import { OpenArtConnectionController } from './genai/openArtConnectionController';
import { OpenArtCatalogStore } from './genai/openArtCatalogStore';
import { DesktopHiggsfieldCredentialStore } from './genai/higgsfieldCredentialStore';
import { HiggsfieldConnectionController } from './genai/higgsfieldConnectionController';
import { GenAiProviderRegistry } from './genai/providerRegistry';
import { GenerationRuntimeRegistry } from './genai/generationRuntimeRegistry';
import { LocalAiConnectionController } from './genai/localAiConnectionController';
import { LocalAiProcessManager } from './genai/localAiProcessManager';
import { LocalAiGenerationController } from './genai/localAiGenerationController';
import { LocalAiModelManager } from './genai/localAiModelManager';
import {
  recordProjectAssetRemoteLink,
  replaceProjectAssetRemoteLinkId,
  resolveProjectAssetRemoteLinks
} from './genai/projectAssetRemoteLinks';
import { prepareProjectAssetReferences } from './genai/prepareProjectAssetReferences';
import {
  deleteProjectGenerationJob,
  listProjectGenerationJobs,
  replaceProjectGenerationAssetId,
  updateProjectGenerationJob,
  upsertProjectGenerationJob
} from './genai/projectGenerationJobStore';
import { loadProjectGenAiSetup, saveProjectGenAiSetup } from './genai/projectGenAiSetupStore';
import { generationRecoveryAction } from './genai/generationRecovery';
import {
  generationTrackingTimedOut,
  generationTrackingTimeRemaining,
  generationTrackingTimeoutError,
  isGenerationTrackingTimeout
} from './genai/generationTrackingPolicy';
import { OPENART_PROVIDER_ID } from '@lighttable/genai-openart';
import { HIGGSFIELD_PROVIDER_ID } from '@lighttable/genai-higgsfield';
import { LOCAL_AI_PROVIDER_ID } from '@lighttable/genai-local';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let rendererOrigin = '';
let packagedRendererServer: Server | null = null;
let pendingUpdate: { readonly manifest: SignedUpdateManifest; readonly filePath: string } | null = null;
let agentAccessBridge: AgentAccessBridge | null = null;
let agentTunnel: AgentTunnelController | null = null;
let openArtConnection: OpenArtConnectionController | null = null;
let higgsfieldConnection: HiggsfieldConnectionController | null = null;
let genAiProviderRegistry: GenAiProviderRegistry | null = null;
let generationRuntimeRegistry: GenerationRuntimeRegistry | null = null;
let localAiProcessManager: LocalAiProcessManager | null = null;
let localAiConnection: LocalAiConnectionController | null = null;
let localAiGeneration: LocalAiGenerationController | null = null;
let localAiModelManager: LocalAiModelManager | null = null;
const httpAiConnections = new Map<string, LocalAiConnectionController>();
const httpAiGenerations = new Map<string, LocalAiGenerationController>();
let activeProjectManifestPath: string | null = null;
let projectLastUsedOperation: Promise<unknown> = Promise.resolve();
let agentRequestSequence = 0;
const pendingAgentRequests = new Map<string, {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}>();

const automationUserData = process.env.LIGHTTABLE_AUTOMATION_USER_DATA;
if (automationUserData) app.setPath('userData', path.resolve(automationUserData));

const NAVIGATION_ABORTED = -3;
const recentFilesPath = (): string => path.join(app.getPath('userData'), 'recent-files.json');
const recentFileOperations = new RecentFileOperationQueue();
const recentProjectsPath = (): string => path.join(app.getPath('userData'), 'recent-projects.json');
const recentProjectOperations = new RecentFileOperationQueue();
const RECENT_THUMBNAIL_CACHE_LIMIT = 24;
const recentThumbnailCache = new BoundedLruCache<string>(RECENT_THUMBNAIL_CACHE_LIMIT);

const rememberProjectAssetAsLastUsed = async (manifestPath: string, requestedAssetId: string): Promise<void> => {
  const operation = projectLastUsedOperation.catch(() => undefined).then(async () => {
    const { index } = await readProjectAssetIndex(manifestPath);
    const entry = index.assets.find(({ id }) => id === requestedAssetId);
    if (!entry) return;
    await setProjectLastUsedDocument(manifestPath, {
      assetId: entry.id,
      relativePath: entry.path,
      name: entry.name,
      updatedAt: new Date().toISOString()
    });
  });
  projectLastUsedOperation = operation;
  await operation;
};

const rememberActiveProjectFileAsLastUsed = async (filePath: string): Promise<void> => {
  const manifestPath = activeProjectManifestPath;
  if (!manifestPath) return;
  const { rootPath, index } = await readProjectAssetIndex(manifestPath);
  const relativePath = path.relative(rootPath, path.resolve(filePath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
  const portablePath = relativePath.split(path.sep).join('/').toLocaleLowerCase('en-US');
  let entry = index.assets.find((candidate) => candidate.path.toLocaleLowerCase('en-US') === portablePath);
  if (!entry) {
    const rebuilt = await rebuildProjectAssetIndex({ manifestPath });
    entry = rebuilt.assets.find((candidate) => candidate.path.toLocaleLowerCase('en-US') === portablePath);
  }
  if (entry) await rememberProjectAssetAsLastUsed(manifestPath, entry.id);
};
const releaseChannel = releaseChannelFor(
  app.getVersion(),
  app.isPackaged,
  process.env.LIGHTTABLE_RELEASE_CHANNEL
);
const releaseInfo = () => ({
  version: app.getVersion(),
  channel: releaseChannel,
  build: process.env.LIGHTTABLE_BUILD_ID || `local-${process.platform}-${process.arch}`,
  packaged: app.isPackaged,
  signed: process.env.LIGHTTABLE_RELEASE_SIGNED === 'true',
  updateConfigured: Boolean(
    process.env.LIGHTTABLE_UPDATE_MANIFEST_URL && process.env.LIGHTTABLE_UPDATE_PUBLIC_KEY_PEM
  )
});
const defaultRecoveryRoot = () => path.join(app.getPath('userData'), 'recovery-v1');
const recoveryLocationPath = () => path.join(app.getPath('userData'), 'recovery-location.json');
const recoveryStore = new DesktopRecoveryStore(
  defaultRecoveryRoot(),
  undefined,
  undefined,
  {
    encode(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-protected recovery metadata storage is unavailable.');
      }
      return new Uint8Array(safeStorage.encryptString(value));
    },
    decode(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-protected recovery metadata storage is unavailable.');
      }
      return safeStorage.decryptString(Buffer.from(value));
    }
  }
);
const validRecoveryRoot = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 32_768
  && path.isAbsolute(value)
  && path.resolve(value) === value;
const recoveryRootReady = (async () => {
  try {
    const parsed = JSON.parse(await readFile(recoveryLocationPath(), 'utf8')) as {
      readonly version?: unknown;
      readonly root?: unknown;
    };
    if (parsed.version === 1 && validRecoveryRoot(parsed.root)) {
      await recoveryStore.setRoot(parsed.root);
    }
  } catch {
    // The default application-data location needs no preference file.
  }
})();
const recoveryLocation = async () => {
  await recoveryRootReady;
  const root = recoveryStore.getRoot();
  const custom = root !== defaultRecoveryRoot();
  return {
    label: custom ? root : 'LightTable application data · recovery-v1',
    path: root,
    custom,
    canChoose: true
  };
};
const defaultRecoveryLocation = () => ({
  label: 'LightTable application data · recovery-v1',
  path: defaultRecoveryRoot(),
  custom: false,
  canChoose: true
});
const persistRecoveryRoot = async (root: string | null) => {
  const next = root ?? defaultRecoveryRoot();
  if (!validRecoveryRoot(next)) throw new Error('Invalid recovery folder.');
  if (root) {
    await atomicWriteFile({
      targetPath: recoveryLocationPath(),
      bytes: new TextEncoder().encode(JSON.stringify({ version: 1, root }, null, 2))
    });
  } else {
    try {
      await unlink(recoveryLocationPath());
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOENT')) throw reason;
    }
  }
  await recoveryStore.setRoot(next);
  return recoveryLocation();
};
const systemFonts = new WindowsSystemFontCatalog(
  [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'),
    ...(process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')]
      : [])
  ],
  path.join(app.getPath('userData'), 'system-font-catalog-v1.json')
);

if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  // Keep Chromium's development-only HTTP/code cache separate from userData.
  // run_clean can remove stale transformed worker modules without touching
  // recent files or any other user-owned application state.
  app.setPath('sessionData', path.join(app.getAppPath(), '.electron-dev-session'));
}

const recentFileId = (filePath: string): string => createHash('sha256')
  .update(canonicalRecentFilePath(filePath))
  .digest('hex')
  .slice(0, 24);

const loadRecentFiles = async (): Promise<PersistedRecentFile[]> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(recentFilesPath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return normalizeRecentFiles(parsed.filter((entry): entry is PersistedRecentFile => Boolean(
      entry &&
      typeof entry === 'object' &&
      typeof (entry as PersistedRecentFile).id === 'string' &&
      typeof (entry as PersistedRecentFile).path === 'string' &&
      typeof (entry as PersistedRecentFile).openedAt === 'number'
    )));
  } catch {
    return [];
  }
};

const saveRecentFiles = async (entries: readonly PersistedRecentFile[]): Promise<void> => {
  await writeFile(recentFilesPath(), JSON.stringify(normalizeRecentFiles(entries), null, 2));
};

const rememberRecentFile = async (filePath: string): Promise<void> => {
  await recentFileOperations.run(async () => {
    const id = recentFileId(filePath);
    recentThumbnailCache.delete(id);
    await saveRecentFiles(touchRecentFile(await loadRecentFiles(), {
      id,
      path: filePath,
      openedAt: Date.now()
    }));
  });
};

const rememberRecentFileBatch = async (filePaths: readonly string[]): Promise<void> => {
  if (!filePaths.length) return;
  await recentFileOperations.run(async () => {
    let entries = await loadRecentFiles();
    const openedAt = Date.now();
    for (const [index, filePath] of filePaths.entries()) {
      const id = recentFileId(filePath);
      recentThumbnailCache.delete(id);
      entries = touchRecentFile(entries, { id, path: filePath, openedAt: openedAt + index });
    }
    await saveRecentFiles(entries);
  });
};

const forgetRecentFile = (id: string): Promise<void> =>
  recentFileOperations.run(async () => {
    recentThumbnailCache.delete(id);
    await saveRecentFiles(
      (await loadRecentFiles()).filter((candidate) => candidate.id !== id)
    );
  });

interface PersistedRecentProject extends PersistedRecentFile {
  readonly name: string;
}

const recentProjectId = (manifestPath: string): string => createHash('sha256')
  .update(canonicalRecentFilePath(manifestPath))
  .digest('hex')
  .slice(0, 24);

const loadRecentProjects = async (): Promise<PersistedRecentProject[]> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(recentProjectsPath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return normalizeRecentFiles(parsed.filter((entry): entry is PersistedRecentProject => Boolean(
      entry && typeof entry === 'object'
      && typeof (entry as PersistedRecentProject).id === 'string'
      && typeof (entry as PersistedRecentProject).path === 'string'
      && typeof (entry as PersistedRecentProject).name === 'string'
      && typeof (entry as PersistedRecentProject).openedAt === 'number'
    )));
  } catch {
    return [];
  }
};

const saveRecentProjects = async (entries: readonly PersistedRecentProject[]): Promise<void> => {
  await writeFile(recentProjectsPath(), JSON.stringify(normalizeRecentFiles(entries), null, 2));
};

const rememberRecentProject = (project: DesktopProjectSummary): Promise<void> =>
  recentProjectOperations.run(async () => saveRecentProjects(touchRecentFile(await loadRecentProjects(), {
    id: recentProjectId(project.manifestPath),
    path: project.manifestPath,
    name: project.name,
    openedAt: Date.now()
  })));

const readDesktopFilePayload = async (filePath: string) => ({
  name: path.basename(filePath),
  type: desktopMediaTypeForFileName(filePath),
  bytes: new Uint8Array(await readFile(filePath)),
  sourcePath: path.resolve(filePath)
});

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'cross-origin-isolated=(self)'
} as const;

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

async function startPackagedRendererServer(): Promise<string> {
  const rendererRoot = path.resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = path.resolve(rendererRoot, relativePath);
      const insideRenderer = filePath === rendererRoot || filePath.startsWith(`${rendererRoot}${path.sep}`);
      if (!insideRenderer) {
        response.writeHead(403, ISOLATION_HEADERS);
        response.end('Forbidden');
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error('Not a file');
      const bytes = await readFile(filePath);
      response.writeHead(200, {
        ...ISOLATION_HEADERS,
        'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': bytes.byteLength
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, ISOLATION_HEADERS);
      response.end('Not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('LightTable could not start its local renderer server.');
  }
  packagedRendererServer = server;
  return `http://127.0.0.1:${address.port}`;
}

function isTrustedSender(senderUrl: string): boolean {
  return Boolean(rendererOrigin) && senderUrl.startsWith(`${rendererOrigin}/`);
}

function assertTrustedSender(senderUrl: string): void {
  if (!isTrustedSender(senderUrl)) {
    throw new Error('Rejected an IPC request from an untrusted renderer.');
  }
}

function senderUrlOrThrow(senderFrame: Electron.WebFrameMain | null): string {
  if (!senderFrame) throw new Error('Rejected an IPC request without a sender frame.');
  return senderFrame.url;
}

function reportDesktopStartupFailure(error: unknown): void {
  console.error('[LightTable desktop] Startup failed.', error);
}

const invokeAgentRenderer = (method: string, parameters: unknown): Promise<unknown> => {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error('LightTable renderer is unavailable.'));
  const id = `agent-${Date.now().toString(36)}-${(++agentRequestSequence).toString(36)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAgentRequests.delete(id);
      reject(new Error('LightTable agent request timed out.'));
    }, 15_000);
    pendingAgentRequests.set(id, { resolve, reject, timeout });
    mainWindow?.webContents.send('lighttable:agent-access-request', { id, method, parameters });
  });
};

const rejectPendingAgentRequests = (message: string): void => {
  for (const [id, pending] of pendingAgentRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
    pendingAgentRequests.delete(id);
  }
};

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#101216',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: automationUserData ? ['--lighttable-automation'] : []
    }
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged || input.type !== 'keyDown' || input.key !== 'F12') return;
    event.preventDefault();
    if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
    else window.webContents.openDevTools({ mode: 'detach', activate: true });
  });
  let wheelProbeCount = 0;
  window.webContents.on('before-mouse-event', (event, mouse) => {
    if (mouse.type !== 'mouseWheel') return;
    const wheel = mouse as Electron.MouseWheelInputEvent;
    if (!app.isPackaged && wheelProbeCount < 20) {
      wheelProbeCount += 1;
      console.info('[LightTable desktop wheel input]', {
        sample: wheelProbeCount,
        x: wheel.x,
        y: wheel.y,
        deltaX: wheel.deltaX ?? 0,
        deltaY: wheel.deltaY ?? 0,
        wheelTicksX: wheel.wheelTicksX ?? 0,
        wheelTicksY: wheel.wheelTicksY ?? 0,
        precise: wheel.hasPreciseScrollingDeltas ?? false,
        modifiers: wheel.modifiers ?? []
      });
    }
    const deltaX = wheel.deltaX ?? 0;
    const wheelTicksX = wheel.wheelTicksX ?? 0;
    if (deltaX === 0 && wheelTicksX === 0) return;
    // Windows mouse drivers do not consistently expose a horizontal wheel to
    // Chromium's DOM WheelEvent. Forward it once from Electron's native input
    // boundary and suppress the duplicate page event when Chromium does emit it.
    event.preventDefault();
    window.webContents.send('lighttable:horizontal-wheel', {
      clientX: wheel.x,
      clientY: wheel.y,
      deltaX: deltaX || wheelTicksX * 40
    });
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url)) event.preventDefault();
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    // Chromium aborts the in-flight development navigation when Vite/HMR
    // immediately replaces it. The succeeding navigation owns readiness; this
    // is not a renderer failure and must not become an unhandled rejection.
    if (isMainFrame && errorCode !== NAVIGATION_ABORTED) {
      console.error(`[LightTable renderer] Failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[LightTable renderer] Process exited: ${details.reason} (${details.exitCode})`);
    rejectPendingAgentRequests('LightTable renderer stopped.');
    void agentAccessBridge?.disable();
    void agentTunnel?.disconnect(false);
  });
  window.once('ready-to-show', () => {
    if (process.env.LIGHTTABLE_AUTOMATION_HEADLESS !== '1') window.show();
  });
  window.on('enter-full-screen', () => {
    window.webContents.send('lighttable:fullscreen-changed', true);
  });
  window.on('leave-full-screen', () => {
    window.webContents.send('lighttable:fullscreen-changed', false);
  });

  const navigation = await loadRendererUrlWithRetry(window, `${rendererOrigin}/`, {
    onRetry: (attempt, reason) => {
      console.warn(`[LightTable renderer] Local navigation attempt ${attempt} failed; retrying.`, reason);
    }
  });
  if (navigation === 'superseded') return;

  const isolation = await window.webContents.executeJavaScript(`({
    href: location.href,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof globalThis.SharedArrayBuffer !== 'undefined'
  })`);
  console.info('[LightTable desktop isolation]', isolation);
}

void app.whenReady().then(async () => {
  // LightTable owns its visible menu and tool modifiers in the renderer. The
  // default Windows Electron menu would otherwise steal focus when Alt is used
  // for eyedropper, centre-origin drawing or zoom-out gestures.
  Menu.setApplicationMenu(null);
  rendererOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL.replace(/\/+$/, '')
    : await startPackagedRendererServer();

  // Force the isolation contract at the Electron session boundary as well.
  // This protects development against Vite middleware/plugin regressions and
  // makes the requirement observable in one host-owned place.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(`${rendererOrigin}/`)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        ...Object.fromEntries(
          Object.entries(ISOLATION_HEADERS).map(([name, value]) => [name, [value]])
        )
      }
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const credentialProtector = {
    available: () => safeStorage.isEncryptionAvailable(),
    protect: (value: string) => new Uint8Array(safeStorage.encryptString(value)),
    unprotect: (value: Uint8Array) => safeStorage.decryptString(Buffer.from(value))
  };
  const openArtCredentialStore = new DesktopOpenArtCredentialStore(
    path.join(app.getPath('userData'), 'genai', 'openart-credentials.bin'),
    credentialProtector
  );
  openArtConnection = new OpenArtConnectionController({
    version: app.getVersion(),
    store: openArtCredentialStore,
    catalogStore: new OpenArtCatalogStore(path.join(app.getPath('userData'), 'genai-openart-catalog-v1.json')),
    host: {
      createAuthorizationSession: (state) => createLoopbackOAuthSession(state),
      openExternal: async (url) => { await shell.openExternal(url); }
    }
  });
  higgsfieldConnection = new HiggsfieldConnectionController({
    version: app.getVersion(),
    store: new DesktopHiggsfieldCredentialStore(
      path.join(app.getPath('userData'), 'genai', 'higgsfield-credentials.bin'),
      credentialProtector
    ),
    host: {
      createAuthorizationSession: (state) => createLoopbackOAuthSession(state, undefined, 'higgsfield'),
      openExternal: async (url) => { await shell.openExternal(url); }
    }
  });
  localAiProcessManager = new LocalAiProcessManager({
    serviceEntryPath: app.isPackaged
      ? path.join(process.resourcesPath, 'local-ai-provider', 'src', 'cli.mjs')
      : path.resolve(app.getAppPath(), '../local-ai-provider/src/cli.mjs'),
    environment: {
      LIGHTTABLE_LOCAL_AI_WORK: path.join(app.getPath('userData'), 'local-ai', 'jobs'),
      LIGHTTABLE_LOCAL_AI_OUTPUT: path.join(app.getPath('userData'), 'local-ai', 'outputs'),
      LIGHTTABLE_SD_CLI: app.isPackaged
        ? path.join(process.resourcesPath, 'local-ai-runtime', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli')
        : path.resolve(app.getAppPath(), '../../.referenceCode/local-ai-runtime',
          process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli'),
      LIGHTTABLE_LOCAL_AI_MODEL_DIR: app.isPackaged
        ? path.join(app.getPath('userData'), 'local-ai', 'models')
        : path.resolve(app.getAppPath(), '../../.local-ai/models')
    }
  });
  const localAiModelDirectory = app.isPackaged
    ? path.join(app.getPath('userData'), 'local-ai', 'models')
    : path.resolve(app.getAppPath(), '../../.local-ai/models');
  localAiModelManager = new LocalAiModelManager({
    modelCliPath: app.isPackaged
      ? path.join(process.resourcesPath, 'local-ai-provider', 'src', 'modelCli.mjs')
      : path.resolve(app.getAppPath(), '../local-ai-provider/src/modelCli.mjs'),
    modelDirectory: localAiModelDirectory
  });
  localAiModelManager.subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:local-ai-model-changed', status);
    }
  });
  genAiProviderRegistry = new GenAiProviderRegistry();
  genAiProviderRegistry.register(openArtConnection);
  genAiProviderRegistry.register(higgsfieldConnection);
  generationRuntimeRegistry = new GenerationRuntimeRegistry();
  localAiConnection = new LocalAiConnectionController(localAiProcessManager);
  localAiGeneration = new LocalAiGenerationController(localAiConnection);
  genAiProviderRegistry.register(localAiConnection);
  httpAiConnections.set(localAiConnection.providerId, localAiConnection);
  httpAiGenerations.set(localAiConnection.providerId, localAiGeneration);
  const registerLocalGenerationRuntime = (
    providerId: import('@lighttable/genai-core').GenAiProviderId,
    generation: LocalAiGenerationController
  ) => generationRuntimeRegistry!.register({
    providerId,
    async prepare(request, context) {
      return {
        references: await Promise.all(request.references.map(async (reference) => {
          const payload = await context.read(reference.id);
          if (!payload) throw new Error(`The local AI reference "${reference.label}" is unavailable.`);
          if (!payload.mediaType.startsWith('image/')) throw new Error(`Local AI cannot use "${reference.label}" as an image.`);
          return { assetId: reference.id, mediaType: payload.mediaType, payload };
        }))
      };
    },
    async submit(jobId, request, prepared) {
      const status = await generation.submit(request, prepared.references.map((item, index) => ({
        reference: request.references[index]!, payload: item.payload!
      })));
      return { jobId, providerJobId: status.jobId, status: 'submitted' };
    },
    async wait(providerJobId, _request, signal) {
      let status = await generation.status(providerJobId);
      while (!['completed', 'cancelled', 'failed'].includes(status.status)) {
        await abortableDelay(125, signal);
        status = await generation.status(providerJobId);
      }
      if (status.status === 'cancelled') throw new Error('Local AI generation was cancelled.');
      if (status.status === 'failed') throw new Error(status.error?.message ?? 'Local AI generation failed.');
      const complete = await generation.result(providerJobId);
      return complete.images.map((image) => ({ mediaType: image.mediaType, bytes: image.bytes }));
    }
  });
  generationRuntimeRegistry.register({
    providerId: OPENART_PROVIDER_ID as import('@lighttable/genai-core').GenAiProviderId,
    prepare: (request, context) => context.preparePublications(
      OPENART_PROVIDER_ID as import('@lighttable/genai-core').GenAiProviderId,
      request.references.map(({ id }) => id),
      (asset) => openArtConnection!.uploadReference(asset)
    ).then((references) => ({ references })),
    submit: (jobId, request, prepared) => openArtConnection!.submitGeneration(request,
      prepared.references.map((reference) => ({
        assetId: reference.assetId, url: reference.url!, mediaType: reference.mediaType
      })), jobId),
    async wait(providerJobId, _request, signal) {
      const output = await openArtConnection!.waitForGeneration(providerJobId, signal);
      return [{ url: output.url, mediaType: output.mediaType }];
    }
  });
  generationRuntimeRegistry.register({
    providerId: HIGGSFIELD_PROVIDER_ID as import('@lighttable/genai-core').GenAiProviderId,
    prepare: (request, context) => context.preparePublications(
      HIGGSFIELD_PROVIDER_ID as import('@lighttable/genai-core').GenAiProviderId,
      request.references.map(({ id }) => id),
      (asset) => higgsfieldConnection!.uploadReference(asset)
    ).then((references) => ({ references })),
    submit: (jobId, request, prepared) => higgsfieldConnection!.submitGeneration(request,
      prepared.references.map((reference) => ({
        assetId: reference.assetId, providerAssetId: reference.providerAssetId,
        url: reference.url, mediaType: reference.mediaType,
        purpose: request.references.find(({ id }) => id === reference.assetId)?.purpose
      })), jobId),
    async wait(providerJobId, request, signal) {
      const kind = request.kind === 'video' || request.workflowId.includes('video') ? 'video' : 'image';
      const result = await higgsfieldConnection!.waitForGeneration(providerJobId, kind, signal);
      return result.urls.map((url) => ({ url, mediaType: result.mediaType }));
    }
  });
  registerLocalGenerationRuntime(localAiConnection.providerId, localAiGeneration);
  genAiProviderRegistry.subscribe((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:genai-provider-changed', snapshot);
    }
  });
  subscribeProjectAssetCatalog((manifestPath) => {
    if (!mainWindow || mainWindow.isDestroyed() || activeProjectManifestPath !== manifestPath) return;
    void openProjectManifest(manifestPath).then(({ summary }) => {
      if (activeProjectManifestPath === manifestPath && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lighttable:genai-project-assets-changed', summary.id);
      }
    }).catch(() => undefined);
  });
  void openArtConnection.restore();
  void higgsfieldConnection.restore();
  const credentialStore = new DesktopAgentAccessCredentialStore(
    path.join(app.getPath('userData'), 'agent-access', 'credentials.bin'), credentialProtector
  );
  const deviceCredentials = await credentialStore.loadOrCreate().catch(() => ({
    deviceId: createAgentDeviceId(), token: ''
  }));
  agentAccessBridge = new AgentAccessBridge(
    credentialStore,
    invokeAgentRenderer,
    app.getVersion(),
    ['semantic-commands', 'atomic-batches', 'gestures', 'bounded-artifacts']
  );
  agentAccessBridge.subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:agent-access-changed', status);
    }
  });
  agentTunnel = new AgentTunnelController(
    deviceCredentials.deviceId,
    new HttpsAgentPairingClient(process.env.LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS === 'true'),
    new WebSocketAgentTunnelTransport(process.env.LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS === 'true'),
    new ProtectedAgentTunnelSessionStore(
      path.join(app.getPath('userData'), 'agent-access', 'server-session.bin'), credentialProtector
    ),
    invokeAgentRenderer
  );
  agentTunnel.subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:agent-tunnel-changed', status);
    }
  });
  void agentTunnel.restore();

  ipcMain.on('lighttable:agent-access-response', (event, payload: {
    readonly id?: unknown; readonly value?: unknown; readonly error?: unknown;
  }) => {
    if (!isTrustedSender(event.senderFrame?.url ?? '') || typeof payload?.id !== 'string') return;
    const pending = pendingAgentRequests.get(payload.id);
    if (!pending) return;
    pendingAgentRequests.delete(payload.id);
    clearTimeout(pending.timeout);
    if (typeof payload.error === 'string') pending.reject(new Error(payload.error));
    else pending.resolve(payload.value);
  });

  ipcMain.handle('lighttable:agent-access-status', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return agentAccessBridge?.status() ?? { supported: false, enabled: false, state: 'stopped' };
  });
  ipcMain.handle('lighttable:genai-provider-snapshots', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return genAiProviderRegistry?.snapshots() ?? [];
  });
  ipcMain.handle('lighttable:local-ai-model-status', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!localAiModelManager) throw new Error('Local AI model manager is unavailable.');
    return localAiModelManager.status();
  });
  ipcMain.handle('lighttable:local-ai-model-install', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!localAiModelManager) throw new Error('Local AI model manager is unavailable.');
    return localAiModelManager.install();
  });
  ipcMain.handle('lighttable:local-ai-configure', async (event, settings: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!localAiConnection) throw new Error('Local AI connection is unavailable.');
    await localAiConnection.configure(settings as import('@lighttable/app').LightTableLocalAiConnectionSettings);
  });
  ipcMain.handle('lighttable:local-ai-test-connection', (event, settings: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!localAiConnection) throw new Error('Local AI connection is unavailable.');
    return localAiConnection.testConnection(
      settings as import('@lighttable/app').LightTableLocalAiConnectionSettings
    );
  });
  ipcMain.handle('lighttable:ai-provider-configure', async (event, value: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!Array.isArray(value) || !genAiProviderRegistry || !localAiProcessManager || !localAiConnection) {
      throw new Error('Invalid AI provider configuration.');
    }
    const configs = value as readonly import('@lighttable/app').LightTableAiProviderConfig[];
    const desired = new Set(configs.filter(({ enabled }) => enabled).map(({ id }) => id));
    for (const [providerId, connection] of httpAiConnections) {
      if (desired.has(providerId)) continue;
      await connection.disconnect();
      genAiProviderRegistry.unregister(providerId as import('@lighttable/genai-core').GenAiProviderId);
      generationRuntimeRegistry?.unregister(providerId as import('@lighttable/genai-core').GenAiProviderId);
      if (providerId !== LOCAL_AI_PROVIDER_ID) {
        httpAiConnections.delete(providerId);
        httpAiGenerations.delete(providerId);
      }
    }
    for (const config of configs) {
      if (!config.enabled) continue;
      let connection = httpAiConnections.get(config.id);
      if (!connection) {
        connection = new LocalAiConnectionController(
          { baseUrl: config.transport.baseUrl }, undefined,
          { providerId: config.id as import('@lighttable/genai-core').GenAiProviderId, label: config.displayName }
        );
        httpAiConnections.set(config.id, connection);
        const generation = new LocalAiGenerationController(connection);
        httpAiGenerations.set(config.id, generation);
        genAiProviderRegistry.register(connection);
        registerLocalGenerationRuntime(connection.providerId, generation);
      }
      if (!genAiProviderRegistry.has(config.id as import('@lighttable/genai-core').GenAiProviderId)) {
        genAiProviderRegistry.register(connection);
      }
      const configuredGeneration = httpAiGenerations.get(config.id);
      if (configuredGeneration && !generationRuntimeRegistry?.has(connection.providerId)) {
        registerLocalGenerationRuntime(connection.providerId, configuredGeneration);
      }
      if (config.id === LOCAL_AI_PROVIDER_ID && config.localProcess?.autoStart) {
        // A managed provider owns a private dynamic port and token. Do not run it
        // through configureProvider(): that path represents an external/static HTTP
        // transport and would discard the live managed endpoint on every refresh.
        await connection.configure({ mode: 'managed', host: '127.0.0.1', port: 7862 });
        // `autoStart` is a lifecycle promise, not merely transport configuration.
        // Start the private managed process here so commands such as Remove Object
        // can discover image.inpaint without requiring a separate UI connect step.
        // This provider is independent from Agent Access and the LightTable MCP server.
        const snapshot = connection.snapshot().status === 'connected'
          ? connection.snapshot()
          : await connection.connect();
        if (snapshot.status !== 'connected') {
          throw new Error(snapshot.message ?? 'The local AI provider could not be started.');
        }
      } else {
        await connection.configureProvider(config);
      }
    }
  });
  ipcMain.handle('lighttable:ai-provider-test', (event, value: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!value || typeof value !== 'object') throw new Error('Invalid AI provider configuration.');
    const config = value as import('@lighttable/app').LightTableAiProviderConfig;
    const tester = httpAiConnections.get(config.id)
      ?? new LocalAiConnectionController({ baseUrl: config.transport.baseUrl }, undefined, {
        providerId: config.id as import('@lighttable/genai-core').GenAiProviderId,
        label: config.displayName
      });
    if (config.id === LOCAL_AI_PROVIDER_ID && config.localProcess?.autoStart) {
      return tester.testConnection({ mode: 'managed', host: '127.0.0.1', port: 7862 });
    }
    return tester.testProvider(config);
  });
  ipcMain.handle('lighttable:ai-provider-help', async (event, value: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!value || typeof value !== 'object') throw new Error('Invalid AI provider configuration.');
    const config = value as import('@lighttable/app').LightTableAiProviderConfig;
    const base = new URL(config.transport.baseUrl);
    if (!config.transport.allowRemote
      && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(base.hostname.toLowerCase())) {
      throw new Error('Remote provider access is not enabled.');
    }
    const connection = httpAiConnections.get(config.id);
    await shell.openExternal(connection?.snapshot().status === 'connected'
      ? connection.apiHelpUrl()
      : new URL('/api/help', base).toString());
  });
  ipcMain.handle('lighttable:genai-provider-connect', (event, providerId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof providerId !== 'string' || !genAiProviderRegistry) throw new Error('Unsupported GenAI provider.');
    return genAiProviderRegistry.provider(providerId as import('@lighttable/genai-core').GenAiProviderId).connect();
  });
  ipcMain.handle('lighttable:genai-provider-disconnect', (event, providerId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof providerId !== 'string' || !genAiProviderRegistry) throw new Error('Unsupported GenAI provider.');
    return genAiProviderRegistry.provider(providerId as import('@lighttable/genai-core').GenAiProviderId).disconnect();
  });
  ipcMain.handle('lighttable:genai-model-list', (event, providerId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof providerId !== 'string' || !genAiProviderRegistry) throw new Error('Unsupported GenAI provider.');
    return genAiProviderRegistry.provider(providerId as import('@lighttable/genai-core').GenAiProviderId).listModels();
  });
  ipcMain.handle('lighttable:genai-workflow-load', (
    event,
    providerId: unknown,
    modelId: unknown,
    mode: unknown
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof providerId !== 'string' || !genAiProviderRegistry
      || typeof modelId !== 'string' || typeof mode !== 'string') {
      throw new Error('Unsupported GenAI workflow request.');
    }
    return genAiProviderRegistry.provider(providerId as import('@lighttable/genai-core').GenAiProviderId)
      .loadWorkflow(modelId as import('@lighttable/genai-core').GenAiModelId, mode);
  });
  ipcMain.handle('lighttable:genai-cost-estimate', (event, providerId: unknown, modelId: unknown,
    mode: unknown, fields: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof providerId !== 'string' || !genAiProviderRegistry || typeof modelId !== 'string'
      || typeof mode !== 'string' || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new Error('Invalid GenAI cost request.');
    }
    return genAiProviderRegistry.provider(providerId as import('@lighttable/genai-core').GenAiProviderId).estimateCost(
      modelId as import('@lighttable/genai-core').GenAiModelId,
      mode,
      fields as Readonly<Record<string, unknown>>
    );
  });
  const completingGenAiJobs = new Set<string>();
  const submittingGenAiProjects = new Set<string>();
  const genAiJobAbortControllers = new Map<string, AbortController>();
  const publishGenAiJob = (
    projectId: string,
    job: import('@lighttable/genai-core').GenAiGenerationJob
  ) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:genai-job-changed', { projectId, job });
    }
  };
  const failTimedOutGenAiJob = async (
    manifestPath: string,
    projectId: string,
    job: import('@lighttable/genai-core').GenAiGenerationJob
  ): Promise<boolean> => {
    if (!generationTrackingTimedOut(job)) return false;
    const failed = await updateProjectGenerationJob(manifestPath, job.id, (current) => ({
      ...current,
      status: 'failed',
      updatedAt: Date.now(),
      error: generationTrackingTimeoutError().message
    }));
    publishGenAiJob(projectId, failed);
    return true;
  };
  const startGenAiTrackingDeadline = (
    job: import('@lighttable/genai-core').GenAiGenerationJob,
    controller: AbortController
  ): ReturnType<typeof setTimeout> => {
    const timeout = setTimeout(() => controller.abort(generationTrackingTimeoutError()),
      Math.max(1, generationTrackingTimeRemaining(job)));
    timeout.unref();
    return timeout;
  };
  const finishProviderGeneration = async (
    manifestPath: string,
    project: Awaited<ReturnType<typeof openProjectManifest>>,
    jobId: import('@lighttable/genai-core').GenAiJobId,
    providerJobId: string,
    providerId: import('@lighttable/genai-core').GenAiProviderId
  ): Promise<void> => {
    const runtime = generationRuntimeRegistry?.has(providerId)
      ? generationRuntimeRegistry.runtime(providerId) : undefined;
    if (!runtime) return;
    const completionKey = `${manifestPath}\0${jobId}`;
    if (completingGenAiJobs.has(completionKey)) return;
    const job = (await listProjectGenerationJobs(manifestPath)).find(({ id }) => id === jobId);
    if (!job || await failTimedOutGenAiJob(manifestPath, project.summary.id, job)) return;
    completingGenAiJobs.add(completionKey);
    const abortController = new AbortController();
    genAiJobAbortControllers.set(completionKey, abortController);
    const trackingTimeout = startGenAiTrackingDeadline(job, abortController);
    try {
      const outputs = await runtime.wait(providerJobId, job.request, abortController.signal);
      if (!outputs.length) throw new Error('The provider completed without an output.');
      const historyDirectory = resolveProjectStoragePath(project.summary.rootPath, project.manifest, 'aiHistory');
      await mkdir(historyDirectory, { recursive: true });
      const safeProviderJobId = providerJobId.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 96) || String(jobId);
      const providerLabel = providerId === HIGGSFIELD_PROVIDER_ID ? 'Higgsfield'
        : providerId === OPENART_PROVIDER_ID ? 'OpenArt' : 'LocalAI';
      const results: import('@lighttable/genai-core').GenAiGenerationResult[] = [];
      for (const [index, output] of outputs.entries()) {
        abortController.signal.throwIfAborted();
        let mediaType = output.mediaType.split(';')[0]!.trim().toLocaleLowerCase('en-US');
        let bytes = output.bytes;
        if (!bytes && output.url) {
          if (!/^https:\/\//iu.test(output.url)) throw new Error('The provider returned an unsafe output URL.');
          const response = await fetch(output.url, { signal: abortController.signal });
          if (!response.ok) throw new Error(`${providerLabel} output download failed (${response.status}).`);
          const responseMediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLocaleLowerCase('en-US');
          if (responseMediaType && /^(image\/(png|jpeg|webp)|video\/(mp4|webm))$/u.test(responseMediaType)) {
            mediaType = responseMediaType;
          }
          const declaredLength = Number(response.headers.get('content-length') ?? 0);
          if (declaredLength > 512 * 1024 * 1024) throw new Error(`${providerLabel} output exceeds the 512 MiB safety limit.`);
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        if (!bytes?.length || bytes.byteLength > 512 * 1024 * 1024) throw new Error(`${providerLabel} returned an invalid output file.`);
        const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp'
          : mediaType === 'video/webm' ? 'webm' : mediaType.startsWith('video/') ? 'mp4' : 'png';
        const signatureOk = extension === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50
          : extension === 'jpg' ? bytes[0] === 0xff && bytes[1] === 0xd8
            : extension === 'webp' ? String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
              && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
              : extension === 'webm' ? bytes[0] === 0x1a && bytes[1] === 0x45
                : bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
        if (!signatureOk) throw new Error(`${providerLabel} output signature does not match ${mediaType}.`);
        const suffix = outputs.length > 1 ? `-${index + 1}` : '';
        const fileName = `${providerLabel}-${safeProviderJobId}${suffix}.${extension}`;
        const outputPath = path.join(historyDirectory, fileName);
        await atomicWriteFile({ targetPath: outputPath, bytes });
        await recordSavedProjectAsset({ manifestPath, filePath: outputPath });
        const { index: assetIndex } = await readProjectAssetIndex(manifestPath);
        const indexed = assetIndex.assets.find((asset) => asset.path.endsWith(`/History/${fileName}`) || asset.name === fileName);
        if (!indexed) throw new Error('The generated media was saved but could not be indexed.');
        if (output.url) await recordProjectAssetRemoteLink(manifestPath, {
          assetId: indexed.id, providerId, providerJobId, url: output.url, mediaType
        });
        results.push({
          assetId: indexed.id as import('@lighttable/genai-core').GenAiAssetId,
          mediaType, fileName, ...(indexed.thumbnail ? { previewId: indexed.id } : {})
        });
      }
      const saved = await updateProjectGenerationJob(manifestPath, jobId, (current) => ({
        ...current, status: 'succeeded', updatedAt: Date.now(), results
      }));
      publishGenAiJob(project.summary.id, saved);
      mainWindow?.webContents.send('lighttable:genai-project-assets-changed', project.summary.id);
    } catch (reason) {
      if (abortController.signal.aborted && !isGenerationTrackingTimeout(abortController.signal.reason)) return;
      const failure = isGenerationTrackingTimeout(abortController.signal.reason) ? abortController.signal.reason : reason;
      const failed = await updateProjectGenerationJob(manifestPath, jobId, (current) => ({
        ...current, status: 'failed', updatedAt: Date.now(),
        error: failure instanceof Error ? failure.message : String(failure)
      }));
      publishGenAiJob(project.summary.id, failed);
    } finally {
      clearTimeout(trackingTimeout);
      if (genAiJobAbortControllers.get(completionKey) === abortController) genAiJobAbortControllers.delete(completionKey);
      completingGenAiJobs.delete(completionKey);
    }
  };
  ipcMain.handle('lighttable:genai-generation-submit', async (
    event,
    projectId: unknown,
    request: unknown
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!request || typeof request !== 'object' || !activeProjectManifestPath || typeof projectId !== 'string') {
      throw new Error('Invalid GenAI generation request.');
    }
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    if (submittingGenAiProjects.has(projectId)) throw new Error('A generation is already being submitted for this project.');
    submittingGenAiProjects.add(projectId);
    try {
    const generationRequest = request as import('@lighttable/genai-core').GenAiGenerationRequest;
    const manifestPath = activeProjectManifestPath;
    const now = Date.now();
    const jobId = `genai-${randomUUID()}` as import('@lighttable/genai-core').GenAiJobId;
    await upsertProjectGenerationJob(manifestPath, {
      id: jobId,
      request: generationRequest,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      results: []
    });
    const runtime = generationRuntimeRegistry?.has(generationRequest.providerId)
      ? generationRuntimeRegistry.runtime(generationRequest.providerId) : undefined;
    if (!runtime) {
      const failed = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'failed', updatedAt: Date.now(),
        error: `Unsupported GenAI provider: ${generationRequest.providerId}.`
      }));
      publishGenAiJob(project.summary.id, failed);
      throw new Error(`Unsupported GenAI provider: ${generationRequest.providerId}.`);
    }
    const preparationContext: import('./genai/generationRuntimeRegistry').GenerationPreparationContext = {
      read: async (assetId) => {
        const asset = await readProjectAsset(manifestPath, assetId);
        if (!asset) return null;
        return { ...asset, mediaType: desktopMediaTypeForFileName(asset.name) ?? 'application/octet-stream' };
      },
      preparePublications: async (preparedProviderId, assetIds, publish) => (await prepareProjectAssetReferences(
        assetIds, preparedProviderId, {
          resolve: (ids) => resolveProjectAssetRemoteLinks(manifestPath, ids, preparedProviderId),
          read: async (assetId) => {
            const asset = await readProjectAsset(manifestPath, assetId);
            if (!asset) return null;
            return { ...asset, mediaType: desktopMediaTypeForFileName(asset.name) ?? 'application/octet-stream' };
          },
          publish,
          record: (link) => recordProjectAssetRemoteLink(manifestPath, link)
        }
      )).map((link) => ({
        assetId: link.assetId as import('@lighttable/genai-core').GenAiAssetId,
        url: link.url,
        providerAssetId: link.providerAssetId,
        mediaType: link.mediaType
      }))
    };
    let prepared: import('./genai/generationRuntimeRegistry').PreparedGeneration;
    try {
      const preparing = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'preparing-inputs', updatedAt: Date.now()
      }));
      publishGenAiJob(project.summary.id, preparing);
      prepared = await runtime.prepare(generationRequest, preparationContext);
      const ready = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'ready-to-submit', updatedAt: Date.now()
      }));
      publishGenAiJob(project.summary.id, ready);
    } catch (reason) {
      const failed = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'failed', updatedAt: Date.now(),
        error: reason instanceof Error ? reason.message : String(reason)
      }));
      publishGenAiJob(project.summary.id, failed);
      submittingGenAiProjects.delete(projectId);
      throw reason;
    }
    let submission: import('@lighttable/genai-core').GenAiGenerationSubmission;
    try {
      const submitting = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'submitting', updatedAt: Date.now()
      }));
      publishGenAiJob(project.summary.id, submitting);
      submission = await runtime.submit(jobId, generationRequest, prepared);
    } catch (reason) {
      const ambiguous = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
        ...job, status: 'unknown-submit', updatedAt: Date.now(),
        error: reason instanceof Error ? reason.message : String(reason)
      }));
      publishGenAiJob(project.summary.id, ambiguous);
      submittingGenAiProjects.delete(projectId);
      throw reason;
    }
    const running = await updateProjectGenerationJob(manifestPath, jobId, (job) => ({
      ...job, status: 'running', providerJobId: submission.providerJobId, updatedAt: Date.now()
    }));
    publishGenAiJob(project.summary.id, running);
    submittingGenAiProjects.delete(projectId);
    void finishProviderGeneration(manifestPath, project, jobId, submission.providerJobId, generationRequest.providerId);
    return submission;
    } finally {
      submittingGenAiProjects.delete(projectId);
    }
  });
  ipcMain.handle('lighttable:genai-jobs-list', async (event, projectId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || !activeProjectManifestPath) return [];
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    let jobs = await listProjectGenerationJobs(activeProjectManifestPath);
    for (const job of jobs) {
      if (await failTimedOutGenAiJob(activeProjectManifestPath, project.summary.id, job)) continue;
      const recovery = generationRecoveryAction(job);
      if (recovery === 'resume-known-job' && job.providerJobId) {
        void finishProviderGeneration(activeProjectManifestPath, project, job.id, job.providerJobId, job.request.providerId);
      } else if (recovery === 'mark-ambiguous-submit') {
        const ambiguous = await updateProjectGenerationJob(activeProjectManifestPath, job.id, (current) => ({
          ...current,
          status: 'unknown-submit',
          updatedAt: Date.now(),
          error: 'LightTable restarted before the provider job identifier was stored. This job will not be retried automatically.'
        }));
        publishGenAiJob(project.summary.id, ambiguous);
      } else if (recovery === 'mark-interrupted-preparation') {
        const interrupted = await updateProjectGenerationJob(activeProjectManifestPath, job.id, (current) => ({
          ...current,
          status: 'failed',
          updatedAt: Date.now(),
          error: 'LightTable restarted before this job reached the paid submit boundary. Start it again when ready.'
        }));
        publishGenAiJob(project.summary.id, interrupted);
      }
    }
    jobs = await listProjectGenerationJobs(activeProjectManifestPath);
    return jobs;
  });
  const activeGenAiProject = async (projectId: unknown) => {
    if (typeof projectId !== 'string' || !activeProjectManifestPath) {
      throw new Error('A matching active project is required.');
    }
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    return { project, manifestPath: activeProjectManifestPath };
  };
  ipcMain.handle('lighttable:genai-job-stop-tracking', async (event, projectId: unknown, jobId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof jobId !== 'string') throw new Error('Invalid GenAI job.');
    const { project, manifestPath } = await activeGenAiProject(projectId);
    genAiJobAbortControllers.get(`${manifestPath}\0${jobId}`)?.abort(new DOMException('Tracking stopped.', 'AbortError'));
    const cancelled = await updateProjectGenerationJob(manifestPath, jobId as import('@lighttable/genai-core').GenAiJobId, (job) => ({
      ...job, status: 'cancelled', updatedAt: Date.now(),
      error: job.providerJobId
        ? 'Local tracking stopped. The provider job may still complete and can be resumed without submitting again.'
        : 'Tracking stopped before a provider job identifier was available.'
    }));
    publishGenAiJob(project.summary.id, cancelled);
    return cancelled;
  });
  ipcMain.handle('lighttable:genai-job-resume-tracking', async (event, projectId: unknown, jobId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof jobId !== 'string') throw new Error('Invalid GenAI job.');
    const { project, manifestPath } = await activeGenAiProject(projectId);
    const jobs = await listProjectGenerationJobs(manifestPath);
    const current = jobs.find((job) => job.id === jobId);
    if (!current?.providerJobId) throw new Error('This job has no provider identifier and cannot be resumed safely.');
    if (current.status === 'succeeded') return current;
    const running = await updateProjectGenerationJob(manifestPath, current.id, (job) => ({
      ...job, status: 'running', updatedAt: Date.now(), error: undefined
    }));
    publishGenAiJob(project.summary.id, running);
    void finishProviderGeneration(manifestPath, project, running.id, current.providerJobId, current.request.providerId);
    return running;
  });
  const genAiResultPath = async (projectId: unknown, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new Error('Invalid GenAI job.');
    const { project, manifestPath } = await activeGenAiProject(projectId);
    const job = (await listProjectGenerationJobs(manifestPath)).find(({ id }) => id === jobId);
    const assetId = job?.results[0]?.assetId;
    if (!job || !assetId) throw new Error('This generation has no saved result.');
    const { rootPath, index } = await readProjectAssetIndex(manifestPath);
    const asset = index.assets.find(({ id }) => id === assetId);
    if (!asset) throw new Error('The generated file is no longer available.');
    const filePath = path.resolve(rootPath, ...asset.path.split('/'));
    const root = path.resolve(rootPath);
    if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid generated file location.');
    return { project, manifestPath, job, filePath };
  };
  ipcMain.handle('lighttable:genai-result-reveal', async (event, projectId: unknown, jobId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { filePath } = await genAiResultPath(projectId, jobId);
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle('lighttable:genai-job-delete', async (event, projectId: unknown, jobId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof jobId !== 'string') throw new Error('Invalid GenAI job.');
    const { project, manifestPath } = await activeGenAiProject(projectId);
    const job = (await listProjectGenerationJobs(manifestPath)).find(({ id }) => id === jobId);
    if (!job) throw new Error('This generation is no longer available.');

    // Deleting history is valid before a provider has produced a file. Stop
    // local tracking first; this does not claim to cancel the paid remote job.
    genAiJobAbortControllers.get(`${manifestPath}\0${job.id}`)?.abort(
      new DOMException('Generation removed from local history.', 'AbortError')
    );
    if (job.results.length) {
      const { rootPath, index } = await readProjectAssetIndex(manifestPath);
      const root = path.resolve(rootPath);
      const filePaths = [...new Set(job.results.flatMap(({ assetId }) => {
        const asset = index.assets.find(({ id }) => id === assetId);
        if (!asset) return [];
        const filePath = path.resolve(rootPath, ...asset.path.split('/'));
        if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid generated file location.');
        return [filePath];
      }))];
      for (const filePath of filePaths) await shell.trashItem(filePath);
    }
    await deleteProjectGenerationJob(manifestPath, job.id);
    publishGenAiJob(project.summary.id, { ...job, status: 'cancelled', updatedAt: Date.now(),
      error: 'Deleted from generation history.', results: [] });
  });
  ipcMain.handle('lighttable:genai-project-asset-catalog', async (event, projectId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || !activeProjectManifestPath) return { sections: [], assets: [] };
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    const { index } = await readProjectAssetIndex(activeProjectManifestPath);
    const remoteLinks = await resolveProjectAssetRemoteLinks(
      activeProjectManifestPath,
      index.assets.map((asset) => asset.id),
      OPENART_PROVIDER_ID
    );
    const publishedIds = new Set(remoteLinks.map((link) => link.assetId));
    const projectDirectories = [...await readProjectAssetDirectories(activeProjectManifestPath)];
    const aiInputPath = project.manifest.folders.aiInput;
    const hasAiInputAssets = index.assets.some((asset) =>
      asset.path === aiInputPath || asset.path.startsWith(`${aiInputPath}/`));
    if (hasAiInputAssets) projectDirectories.push({ path: aiInputPath, label: 'AI Input' });
    const sectionMatches = [...projectDirectories].sort((left, right) => right.path.length - left.path.length);
    const assets = index.assets.map((asset) => ({
      id: asset.id,
      projectId,
      label: asset.name,
      mediaType: desktopMediaTypeForFileName(asset.name) ?? 'application/octet-stream',
      relativePath: asset.path,
      modifiedAt: asset.modifiedAt,
      section: sectionMatches.find((section) => asset.path === section.path || asset.path.startsWith(`${section.path}/`))?.label
        ?? (asset.path.includes('/') ? asset.path.split('/')[0] : 'Root'),
      ...(asset.thumbnail ? { previewId: asset.id } : {}),
      ...(publishedIds.has(asset.id) ? { publishedProviderIds: [OPENART_PROVIDER_ID] } : {})
    }));
    return {
      sections: projectDirectories.map((directory) => ({ id: directory.path, label: directory.label })),
      assets
    };
  });
  ipcMain.handle('lighttable:genai-project-assets-refresh', async (event, projectId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { project, manifestPath } = await activeGenAiProject(projectId);
    await rebuildProjectAssetIndex({ manifestPath });
    mainWindow?.webContents.send('lighttable:genai-project-assets-changed', project.summary.id);
  });
  ipcMain.handle('lighttable:genai-project-asset-reveal', async (event, projectId: unknown, assetId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { manifestPath } = await activeGenAiProject(projectId);
    if (typeof assetId !== 'string') throw new Error('Invalid project asset.');
    shell.showItemInFolder(await resolveProjectAssetPath(manifestPath, assetId));
  });
  ipcMain.handle('lighttable:genai-project-asset-rename', async (
    event, projectId: unknown, assetId: unknown, requestedName: unknown
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { project, manifestPath } = await activeGenAiProject(projectId);
    if (typeof assetId !== 'string' || typeof requestedName !== 'string') throw new Error('Invalid rename request.');
    const renamed = await renameProjectAsset({ manifestPath, assetId, name: requestedName });
    await replaceProjectGenerationAssetId(manifestPath, renamed.previousId, renamed.next.id, renamed.next.name);
    await replaceProjectAssetRemoteLinkId(manifestPath, renamed.previousId, renamed.next.id);
    mainWindow?.webContents.send('lighttable:genai-project-assets-changed', project.summary.id);
    return {
      id: renamed.next.id,
      projectId: project.summary.id,
      label: renamed.next.name,
      mediaType: desktopMediaTypeForFileName(renamed.next.name) ?? 'application/octet-stream',
      relativePath: renamed.next.path,
      modifiedAt: renamed.next.modifiedAt,
      ...(renamed.next.thumbnail ? { previewId: renamed.next.id } : {})
    };
  });
  ipcMain.handle('lighttable:genai-project-asset-delete', async (event, projectId: unknown, assetId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { project, manifestPath } = await activeGenAiProject(projectId);
    if (typeof assetId !== 'string') throw new Error('Invalid project asset.');
    await shell.trashItem(await resolveProjectAssetPath(manifestPath, assetId));
    const jobs = await listProjectGenerationJobs(manifestPath);
    await Promise.all(jobs.filter((job) => job.results.some((result) => result.assetId === assetId))
      .map((job) => deleteProjectGenerationJob(manifestPath, job.id)));
    await rebuildProjectAssetIndex({ manifestPath });
    mainWindow?.webContents.send('lighttable:genai-project-assets-changed', project.summary.id);
  });
  ipcMain.handle('lighttable:genai-project-asset-preview', async (
    event,
    projectId: unknown,
    assetId: unknown
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || typeof assetId !== 'string' || !activeProjectManifestPath) return null;
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    const bytes = await readProjectAssetPreview(activeProjectManifestPath, assetId);
    return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` : null;
  });
  ipcMain.handle('lighttable:genai-project-asset-load', async (
    event,
    projectId: unknown,
    assetId: unknown
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || typeof assetId !== 'string' || !activeProjectManifestPath) return null;
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    const asset = await readProjectAsset(activeProjectManifestPath, assetId);
    if (asset) await rememberProjectAssetAsLastUsed(activeProjectManifestPath, assetId);
    return asset ? {
      name: asset.name,
      mediaType: desktopMediaTypeForFileName(asset.name) ?? 'application/octet-stream',
      bytes: asset.bytes
    } : null;
  });
  ipcMain.handle('lighttable:genai-project-asset-import', async (event, projectId: unknown, input: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const { project, manifestPath } = await activeGenAiProject(projectId);
    if (!input || typeof input !== 'object') throw new Error('Invalid project asset import.');
    const asset = input as { name?: unknown; mediaType?: unknown; bytes?: unknown };
    if (typeof asset.name !== 'string' || typeof asset.mediaType !== 'string'
      || !(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength === 0) {
      throw new Error('Invalid project asset import.');
    }
    const extensionByMediaType: Readonly<Record<string, string>> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/tiff': '.tiff',
      'video/mp4': '.mp4', 'video/webm': '.webm'
    };
    const extension = extensionByMediaType[asset.mediaType.toLocaleLowerCase('en-US')];
    if (!extension) throw new Error('Only PNG, JPEG, WebP, TIFF, MP4 and WebM references are supported.');
    const rawBase = path.basename(asset.name, path.extname(asset.name)).trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/[. ]+$/gu, '').slice(0, 120) || 'reference';
    const { manifest, summary } = await openProjectManifest(manifestPath);
    const directory = resolveProjectStoragePath(summary.rootPath, manifest, 'aiInput');
    await mkdir(directory, { recursive: true });
    const fileName = `${rawBase}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, asset.bytes, { flag: 'wx' });
    await recordSavedProjectAsset({ manifestPath, filePath });
    const { index } = await readProjectAssetIndex(manifestPath);
    const relativePath = path.relative(summary.rootPath, filePath).split(path.sep).join('/');
    const indexed = index.assets.find((candidate) => candidate.path === relativePath);
    if (!indexed) throw new Error('The imported reference could not be indexed.');
    mainWindow?.webContents.send('lighttable:genai-project-assets-changed', project.summary.id);
    return {
      id: indexed.id,
      projectId: project.summary.id,
      label: indexed.name,
      mediaType: desktopMediaTypeForFileName(indexed.name) ?? asset.mediaType,
      relativePath: indexed.path,
      modifiedAt: indexed.modifiedAt,
      section: 'AI Input',
      ...(indexed.thumbnail ? { previewId: indexed.id } : {})
    };
  });
  ipcMain.handle('lighttable:genai-project-setup-load', async (event, projectId: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || !activeProjectManifestPath) return null;
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    return loadProjectGenAiSetup(activeProjectManifestPath);
  });
  ipcMain.handle('lighttable:genai-project-setup-save', async (event, projectId: unknown, setup: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || !setup || typeof setup !== 'object' || !activeProjectManifestPath) {
      throw new Error('Invalid GenAI setup save request.');
    }
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId) throw new Error('The requested GenAI project is not active.');
    await saveProjectGenAiSetup(activeProjectManifestPath, setup as import('@lighttable/genai-core').GenAiProjectSetup);
  });
  ipcMain.handle('lighttable:agent-access-enable', (event, port?: number) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return agentAccessBridge?.enable(port ?? 0);
  });
  ipcMain.handle('lighttable:agent-access-disable', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    rejectPendingAgentRequests('Agent Access was stopped.');
    return agentAccessBridge?.disable();
  });
  ipcMain.handle('lighttable:agent-access-rotate', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return agentAccessBridge?.rotateCredentials();
  });
  ipcMain.handle('lighttable:agent-tunnel-status', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return agentTunnel?.status();
  });
  ipcMain.handle('lighttable:agent-tunnel-pair', (event, serverUrl: string, code: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof serverUrl !== 'string' || serverUrl.length > 2048
      || typeof code !== 'string' || code.length > 64) throw new Error('Invalid Agent server pairing request.');
    return agentTunnel?.pair(serverUrl, code);
  });
  ipcMain.handle('lighttable:agent-tunnel-disconnect', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame)); return agentTunnel?.disconnect(false);
  });
  ipcMain.handle('lighttable:agent-tunnel-reconnect', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame)); return agentTunnel?.connect();
  });
  ipcMain.handle('lighttable:agent-client-approve', (event, clientId: string, scopes: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof clientId !== 'string' || clientId.length > 256 || !Array.isArray(scopes)
      || scopes.some((scope) => scope !== 'read' && scope !== 'edit')) throw new Error('Invalid Agent client approval.');
    return agentTunnel?.approveClient(clientId, scopes);
  });
  ipcMain.handle('lighttable:agent-client-revoke', (event, clientId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof clientId !== 'string' || clientId.length > 256) throw new Error('Invalid Agent client revocation.');
    return agentTunnel?.revokeClient(clientId);
  });
  ipcMain.handle('lighttable:agent-device-revoke', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame)); return agentTunnel?.revoke();
  });
  ipcMain.handle('lighttable:agent-activity-cancel', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame)); return agentTunnel?.cancelActivity();
  });
  ipcMain.handle('lighttable:agent-activity-undo', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame)); return agentTunnel?.undoActivity();
  });

  ipcMain.handle('lighttable:open-file', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const automationFile = process.env.LIGHTTABLE_AUTOMATION_OPEN_FILE;
    if (automationFile) return readDesktopFilePayload(path.resolve(automationFile));
    const options: Electron.OpenDialogOptions = {
      title: 'Open in LightTable',
      properties: ['openFile'],
      filters: createDesktopOpenDialogFilters().map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions]
      }))
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;

    const payload = await readDesktopFilePayload(selectedPath);
    await rememberRecentFile(selectedPath);
    await rememberActiveProjectFileAsLastUsed(selectedPath);
    return payload;
  });

  ipcMain.handle('lighttable:set-fullscreen', async (event, enabled: boolean) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen request.');
    mainWindow?.setFullScreen(enabled);
  });

  ipcMain.handle('lighttable:close-application', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    setImmediate(() => app.quit());
  });

  ipcMain.handle('lighttable:list-recent-files', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recentFileOperations.settled();
    return Promise.all((await loadRecentFiles()).map(async (entry) => {
      let available = false;
      try {
        available = (await stat(entry.path)).isFile();
      } catch {
        // Missing files remain visible so the user can identify or remove them.
      }
      return {
        id: entry.id,
        name: path.basename(entry.path),
        available
      };
    }));
  });

  ipcMain.handle('lighttable:load-recent-file-thumbnail', async (event, id: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recent-file request.');
    const cached = recentThumbnailCache.get(id);
    if (cached) return cached;
    await recentFileOperations.settled();
    const entry = (await loadRecentFiles()).find((candidate) => candidate.id === id);
    if (!entry) return null;
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(entry.path, {
        width: 320,
        height: 320
      });
      if (thumbnail.isEmpty()) return null;
      const dataUrl = thumbnail.toDataURL();
      recentThumbnailCache.set(id, dataUrl);
      return dataUrl;
    } catch {
      return null;
    }
  });

  ipcMain.handle('lighttable:open-recent-file', async (event, id: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof id !== 'string' || id.length > 128) {
      throw new Error('Invalid recent-file request.');
    }
    // Do not inspect a manifest while another IPC request is still updating
    // it. The subsequent touch is serialized by rememberRecentFile.
    await recentFileOperations.settled();
    const entry = (await loadRecentFiles()).find((candidate) => candidate.id === id);
    if (!entry) return null;
    try {
      const payload = await readDesktopFilePayload(entry.path);
      await rememberRecentFile(entry.path);
      await rememberActiveProjectFileAsLastUsed(entry.path);
      return payload;
    } catch {
      return null;
    }
  });

  ipcMain.handle('lighttable:remember-opened-files', async (event, requestedPaths: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!Array.isArray(requestedPaths) || requestedPaths.length > 128) {
      throw new Error('Invalid opened-files request.');
    }
    const filePaths: string[] = [];
    for (const candidate of requestedPaths) {
      if (typeof candidate !== 'string' || candidate.length > 32_768 || !path.isAbsolute(candidate)) continue;
      const filePath = path.resolve(candidate);
      try {
        if (!(await stat(filePath)).isFile() || !desktopMediaTypeForFileName(filePath)) continue;
        filePaths.push(filePath);
      } catch {
        // A file can disappear between the OS drop and persistence; the other
        // accepted files must still enter the MRU list.
      }
    }
    await rememberRecentFileBatch(filePaths);
    const lastFilePath = filePaths.at(-1);
    if (lastFilePath) await rememberActiveProjectFileAsLastUsed(lastFilePath);
  });

  ipcMain.handle('lighttable:reveal-recent-file', async (event, id: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recent-file request.');
    await recentFileOperations.settled();
    const entry = (await loadRecentFiles()).find((candidate) => candidate.id === id);
    if (!entry) return;
    shell.showItemInFolder(entry.path);
  });

  ipcMain.handle('lighttable:remove-recent-file', async (event, id: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid recent-file request.');
    await forgetRecentFile(id);
  });

  ipcMain.handle('lighttable:clear-recent-files', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recentFileOperations.run(() => saveRecentFiles([]));
  });

  ipcMain.handle('lighttable:project-choose-parent', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const automationParent = process.env.LIGHTTABLE_AUTOMATION_PROJECT_PARENT;
    if (automationParent && process.env.LIGHTTABLE_AUTOMATION_USER_DATA) {
      const resolved = path.resolve(automationParent);
      const details = await stat(resolved);
      if (!details.isDirectory()) throw new Error('The automated project parent is not a directory.');
      return { path: resolved, label: resolved };
    }
    const options: Electron.OpenDialogOptions = {
      title: 'Choose project location',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selectedPath = result.filePaths[0];
    return result.canceled || !selectedPath
      ? null
      : { path: path.resolve(selectedPath), label: path.resolve(selectedPath) };
  });

  ipcMain.handle('lighttable:project-create', async (event, request: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!request || typeof request !== 'object'
      || typeof (request as { name?: unknown }).name !== 'string'
      || typeof (request as { parentPath?: unknown }).parentPath !== 'string'
      || (request as { parentPath: string }).parentPath.length > 32_768) {
      throw new Error('Invalid project creation request.');
    }
    const project = await createProjectOnDisk(request as {
      name: string;
      parentPath: string;
      folders?: import('@lighttable/app/project-manifest').ProjectFolderMappings;
      createFolders?: readonly import('@lighttable/app/project-manifest').ProjectUserStorageLocation[];
      userFolders?: readonly import('@lighttable/app/project-manifest').ProjectUserFolder[];
    });
    await rememberRecentProject(project);
    activateProjectAssetCatalog(project.manifestPath);
    activeProjectManifestPath = project.manifestPath;
    return project;
  });

  ipcMain.handle('lighttable:project-current', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!activeProjectManifestPath) return null;
    try {
      return (await openProjectManifest(activeProjectManifestPath)).summary;
    } catch {
      deactivateProjectAssetCatalog();
      activeProjectManifestPath = null;
      return null;
    }
  });

  ipcMain.handle('lighttable:project-open', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const options: Electron.OpenDialogOptions = {
      title: 'Open LightTable Project',
      properties: ['openFile'],
      filters: [{ name: 'LightTable Project', extensions: ['ltproject'] }]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const manifestPath = result.filePaths[0];
    if (result.canceled || !manifestPath) return null;
    const project = (await openProjectManifest(manifestPath)).summary;
    await rememberRecentProject(project);
    activateProjectAssetCatalog(project.manifestPath);
    activeProjectManifestPath = project.manifestPath;
    return project;
  });

  ipcMain.handle('lighttable:project-list-recent', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recentProjectOperations.settled();
    return Promise.all((await loadRecentProjects()).map(async (entry) => {
      try {
        const project = (await openProjectManifest(entry.path)).summary;
        return { ...project, recentId: entry.id, available: true };
      } catch {
        return {
          id: entry.id,
          name: entry.name,
          rootPath: path.dirname(entry.path),
          manifestPath: entry.path,
          lastUsedDocument: null,
          recentId: entry.id,
          available: false
        };
      }
    }));
  });

  ipcMain.handle('lighttable:project-open-recent', async (event, recentId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof recentId !== 'string' || recentId.length > 128) throw new Error('Invalid recent-project request.');
    await recentProjectOperations.settled();
    const entry = (await loadRecentProjects()).find((candidate) => candidate.id === recentId);
    if (!entry) return null;
    try {
      const project = (await openProjectManifest(entry.path)).summary;
      await rememberRecentProject(project);
      activateProjectAssetCatalog(project.manifestPath);
      activeProjectManifestPath = project.manifestPath;
      return project;
    } catch {
      return null;
    }
  });

  ipcMain.handle('lighttable:project-recent-thumbnail', async (event, recentId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof recentId !== 'string' || recentId.length > 128) throw new Error('Invalid recent-project request.');
    await recentProjectOperations.settled();
    const entry = (await loadRecentProjects()).find((candidate) => candidate.id === recentId);
    if (!entry) return null;
    try {
      const { manifest } = await openProjectManifest(entry.path);
      if (!manifest.lastUsedDocument) return null;
      const bytes = await readProjectAssetPreview(entry.path, manifest.lastUsedDocument.assetId);
      if (bytes) return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
      const assetPath = await resolveProjectAssetPath(entry.path, manifest.lastUsedDocument.assetId);
      const thumbnail = await nativeImage.createThumbnailFromPath(assetPath, { width: 640, height: 360 });
      return thumbnail.isEmpty() ? null : thumbnail.toDataURL();
    } catch {
      return null;
    }
  });

  ipcMain.handle('lighttable:project-open-last-document', async (event, projectId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof projectId !== 'string' || !activeProjectManifestPath) return null;
    const project = await openProjectManifest(activeProjectManifestPath);
    if (project.summary.id !== projectId || !project.manifest.lastUsedDocument) return null;
    const asset = await readProjectAsset(activeProjectManifestPath, project.manifest.lastUsedDocument.assetId);
    if (!asset) return null;
    await rememberProjectAssetAsLastUsed(activeProjectManifestPath, project.manifest.lastUsedDocument.assetId);
    return {
      name: asset.name,
      type: desktopMediaTypeForFileName(asset.name) ?? 'application/octet-stream',
      bytes: asset.bytes
    };
  });

  ipcMain.handle('lighttable:project-reveal', async (event, manifestPath: unknown) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof manifestPath !== 'string' || manifestPath.length > 32_768) {
      throw new Error('Invalid project-location request.');
    }
    const project = await openProjectManifest(manifestPath);
    const error = await shell.openPath(project.summary.rootPath);
    if (error) throw new Error(error);
  });

  ipcMain.handle('lighttable:project-close', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    deactivateProjectAssetCatalog();
    activeProjectManifestPath = null;
  });

  ipcMain.handle('lighttable:project-remove-recent', async (event, recentId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof recentId !== 'string' || recentId.length > 128) throw new Error('Invalid recent-project request.');
    await recentProjectOperations.run(async () => saveRecentProjects(
      (await loadRecentProjects()).filter((candidate) => candidate.id !== recentId)
    ));
  });

  ipcMain.handle('lighttable:project-clear-recent', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recentProjectOperations.run(() => saveRecentProjects([]));
  });

  ipcMain.handle('lighttable:save-file', async (event, payload: DesktopSavePayload) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (
      !payload ||
      typeof payload.suggestedName !== 'string' ||
      !(payload.bytes instanceof Uint8Array) ||
      payload.bytes.byteLength > 2_147_483_647 ||
      (payload.projectManifestPath !== undefined && (
        typeof payload.projectManifestPath !== 'string'
        || payload.projectManifestPath.length > 32_768
      )) ||
      (payload.transaction !== undefined && (
        !payload.transaction ||
        typeof payload.transaction.id !== 'string' ||
        typeof payload.transaction.documentId !== 'string' ||
        !Number.isSafeInteger(payload.transaction.revision) ||
        payload.transaction.revision < 0
      ))
    ) {
      throw new Error('Invalid LightTable save request.');
    }

    const options: Electron.SaveDialogOptions = {
      title: 'Save from LightTable',
      defaultPath: payload.suggestedName
    };
    const automationSaveFile = process.env.LIGHTTABLE_AUTOMATION_SAVE_FILE;
    const result = automationSaveFile
      ? { canceled: false, filePath: path.resolve(automationSaveFile) }
      : mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { status: 'canceled' };
    try {
      const committed = await atomicWriteFile({
        targetPath: result.filePath,
        bytes: payload.bytes
      });
      try {
        await rememberRecentFile(result.filePath);
      } catch (reason) {
        console.warn('[LightTable desktop] Saved the document but could not update recents.', reason);
      }
      if (payload.projectManifestPath) {
        scheduleSavedProjectAsset({
          manifestPath: payload.projectManifestPath,
          filePath: result.filePath
        });
      }
      return { status: 'committed', durability: committed.durability };
    } catch (reason) {
      const failure = reason instanceof AtomicWriteError
        ? reason
        : new AtomicWriteError(
            'write',
            reason instanceof Error ? reason.message : String(reason),
            reason
          );
      return {
        status: 'failed',
        phase: failure.phase,
        message: failure.message
      };
    }
  });

  ipcMain.handle('lighttable:recovery-write', async (event, payload) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recoveryRootReady;
    if (!payload || typeof payload.documentId !== 'string'
      || payload.documentId.length > 1024
      || !(payload.bytes instanceof Uint8Array)
      || payload.bytes.byteLength > 2_147_483_647) {
      throw new Error('Invalid LightTable recovery write request.');
    }
    return recoveryStore.write(payload);
  });

  ipcMain.handle('lighttable:recovery-remove', async (
    event,
    documentId: string,
    throughRevision?: number
  ) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recoveryRootReady;
    if (typeof documentId !== 'string' || documentId.length > 1024
      || (throughRevision !== undefined && (
        !Number.isSafeInteger(throughRevision) || throughRevision < 0
      ))) {
      throw new Error('Invalid LightTable recovery remove request.');
    }
    await recoveryStore.remove(documentId, throughRevision);
  });

  ipcMain.handle('lighttable:recovery-list', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recoveryRootReady;
    const listing = await recoveryStore.list();
    const records = await Promise.all(listing.records.map(async (record) => {
      if (!record.sourcePath) return { ...record, sourceAvailability: 'unavailable' as const };
      try {
        const source = await stat(record.sourcePath);
        const newer = record.sourceLastModified !== undefined
          && source.mtimeMs > record.sourceLastModified + 1;
        return { ...record, sourceAvailability: newer ? 'newer' as const : 'available' as const };
      } catch {
        return { ...record, sourceAvailability: 'missing' as const };
      }
    }));
    return { ...listing, records };
  });

  ipcMain.handle('lighttable:recovery-remove-record', async (event, recoveryId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recoveryRootReady;
    if (typeof recoveryId !== 'string' || recoveryId.length > 128) {
      throw new Error('Invalid LightTable recovery removal request.');
    }
    await recoveryStore.removeRecord(recoveryId);
  });

  ipcMain.handle('lighttable:recovery-read', async (event, recoveryId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    await recoveryRootReady;
    if (typeof recoveryId !== 'string' || recoveryId.length > 128) {
      throw new Error('Invalid LightTable recovery read request.');
    }
    const entry = await recoveryStore.read(recoveryId);
    if (!entry) return null;
    return {
      record: entry.record,
      bytes: new Uint8Array(await entry.artifact.arrayBuffer())
    };
  });

  ipcMain.handle('lighttable:recovery-location', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return recoveryLocation();
  });

  ipcMain.handle('lighttable:recovery-location-choose', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const current = await recoveryLocation();
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: 'Choose autosave location',
          defaultPath: current.path,
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: 'Choose autosave location',
          defaultPath: current.path,
          properties: ['openDirectory', 'createDirectory']
        });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const root = path.resolve(selected, 'LightTable Recovery');
    return { label: root, path: root, custom: true, canChoose: true };
  });

  ipcMain.handle('lighttable:recovery-location-reset', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return defaultRecoveryLocation();
  });

  ipcMain.handle('lighttable:recovery-location-apply', async (event, root?: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (root !== undefined && !validRecoveryRoot(root)) throw new Error('Invalid recovery folder.');
    if (root) await mkdir(root, { recursive: true, mode: 0o700 });
    return persistRecoveryRoot(root ?? null);
  });

  ipcMain.handle('lighttable:clipboard-write-png', async (event, bytes: Uint8Array) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024 * 1024) {
      throw new Error('Invalid LightTable clipboard image.');
    }
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) throw new Error('The clipboard PNG could not be decoded.');
    clipboard.writeImage(image);
  });

  ipcMain.handle('lighttable:clipboard-read-png', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    return new Uint8Array(image.toPNG());
  });

  ipcMain.handle('lighttable:list-system-fonts', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return systemFonts.list();
  });

  ipcMain.handle('lighttable:load-system-font', async (event, assetId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof assetId !== 'string' || !/^system:[a-f\d]{64}:\d{1,2}$/i.test(assetId)) {
      throw new Error('Invalid system-font request.');
    }
    return systemFonts.load(assetId);
  });

  ipcMain.handle('lighttable:release-info', (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    return releaseInfo();
  });

  ipcMain.handle('lighttable:check-updates', async (event): Promise<LightTableUpdateResult> => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const manifestUrl = process.env.LIGHTTABLE_UPDATE_MANIFEST_URL;
    const publicKeyPem = process.env.LIGHTTABLE_UPDATE_PUBLIC_KEY_PEM?.replaceAll('\\n', '\n');
    if (!manifestUrl || !publicKeyPem) {
      return { status: 'unavailable', message: 'No signed update provider is configured for this build.' };
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    try {
      const manifestResponse = await fetchUpdateManifest(manifestUrl, controller.signal);
      if (!manifestResponse.ok) return manifestResponse;
      const decision = verifyUpdateManifest({
        value: manifestResponse.value,
        publicKeyPem,
        currentVersion: app.getVersion(),
        currentChannel: releaseChannel
      });
      if (decision.status === 'invalid') return decision;
      if (decision.status !== 'available') {
        return { status: decision.status, version: decision.manifest.version };
      }
      const artifactResponse = await fetch(decision.manifest.artifact.url, { signal: controller.signal });
      if (!artifactResponse.ok) {
        return { status: 'unavailable', message: `Update download returned HTTP ${artifactResponse.status}.` };
      }
      const bytes = new Uint8Array(await artifactResponse.arrayBuffer());
      const checked = verifyUpdateArtifact(decision.manifest, bytes);
      if (!checked.ok) return { status: 'invalid', message: checked.message };
      const updatePath = path.join(
        app.getPath('userData'),
        'updates',
        `LightTable-${decision.manifest.version}.update`
      );
      await mkdir(path.dirname(updatePath), { recursive: true });
      await atomicWriteFile({
        targetPath: updatePath,
        bytes,
        validate: async (temporaryPath, expected) => {
          const prepared = await stat(temporaryPath);
          if (!prepared.isFile() || prepared.size !== expected.byteLength) {
            throw new Error('The prepared update length changed before publication.');
          }
        }
      });
      pendingUpdate = { manifest: decision.manifest, filePath: updatePath };
      return {
        status: 'downloaded',
        version: decision.manifest.version,
        releaseNotes: decision.manifest.releaseNotes,
        canInstall: false
      };
    } catch (reason) {
      return controller.signal.aborted
        ? { status: 'canceled', message: 'The update check was canceled or timed out.' }
        : { status: 'unavailable', message: reason instanceof Error ? reason.message : String(reason) };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  });

  ipcMain.handle('lighttable:restart-update', (event, dirtyDocuments: boolean) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (dirtyDocuments) {
      return { status: 'blocked', message: 'Save or close dirty documents before restarting.' };
    }
    if (!pendingUpdate) return { status: 'unavailable', message: 'No verified update is downloaded.' };
    return {
      status: 'unavailable',
      message: `The update is verified at ${pendingUpdate.filePath}, but no production installer provider is configured.`
    };
  });

  ipcMain.handle('lighttable:confirm-discard-changes', async (event, documentTitle: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof documentTitle !== 'string' || documentTitle.length > 1024) {
      throw new Error('Invalid LightTable discard confirmation request.');
    }
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Unsaved changes',
      message: `Discard unsaved changes to “${documentTitle}”?`,
      detail: 'This action cannot be undone.',
      buttons: ['Cancel', 'Discard'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 1;
  });

  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch(reportDesktopStartupFailure);
    }
  });
}).catch(reportDesktopStartupFailure);

app.on('before-quit', () => {
  deactivateProjectAssetCatalog();
  genAiProviderRegistry?.dispose();
  genAiProviderRegistry = null;
  void localAiProcessManager?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    rejectPendingAgentRequests('LightTable is closing.');
    void agentAccessBridge?.disable();
    void agentTunnel?.disconnect(false);
    packagedRendererServer?.close();
    packagedRendererServer = null;
    app.quit();
  }
});
