import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  session
} from 'electron';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopSavePayload } from './desktopBridge';
import { atomicWriteFile, AtomicWriteError } from './atomicFileWriter';
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

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let rendererOrigin = '';
let packagedRendererServer: Server | null = null;
let pendingUpdate: { readonly manifest: SignedUpdateManifest; readonly filePath: string } | null = null;
let agentAccessBridge: AgentAccessBridge | null = null;
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
const RECENT_THUMBNAIL_CACHE_LIMIT = 24;
const recentThumbnailCache = new BoundedLruCache<string>(RECENT_THUMBNAIL_CACHE_LIMIT);
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
const recoveryStore = new DesktopRecoveryStore(
  path.join(app.getPath('userData'), 'recovery-v1'),
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

const forgetRecentFile = (id: string): Promise<void> =>
  recentFileOperations.run(async () => {
    recentThumbnailCache.delete(id);
    await saveRecentFiles(
      (await loadRecentFiles()).filter((candidate) => candidate.id !== id)
    );
  });

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
  });
  window.once('ready-to-show', () => window.show());
  window.on('enter-full-screen', () => {
    window.webContents.send('lighttable:fullscreen-changed', true);
  });
  window.on('leave-full-screen', () => {
    window.webContents.send('lighttable:fullscreen-changed', false);
  });

  try {
    await window.loadURL(`${rendererOrigin}/`);
  } catch (error) {
    const aborted = error instanceof Error && error.message.includes('ERR_ABORTED');
    if (aborted) return;
    throw error;
  }

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

  agentAccessBridge = new AgentAccessBridge(
    new DesktopAgentAccessCredentialStore(
      path.join(app.getPath('userData'), 'agent-access', 'credentials.bin'),
      {
        available: () => safeStorage.isEncryptionAvailable(),
        protect: (value) => new Uint8Array(safeStorage.encryptString(value)),
        unprotect: (value) => safeStorage.decryptString(Buffer.from(value))
      }
    ),
    invokeAgentRenderer,
    app.getVersion(),
    ['semantic-commands', 'atomic-batches', 'gestures', 'bounded-artifacts']
  );
  agentAccessBridge.subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lighttable:agent-access-changed', status);
    }
  });

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
    return payload;
  });

  ipcMain.handle('lighttable:set-fullscreen', async (event, enabled: boolean) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen request.');
    mainWindow?.setFullScreen(enabled);
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
      return payload;
    } catch {
      return null;
    }
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

  ipcMain.handle('lighttable:save-file', async (event, payload: DesktopSavePayload) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (
      !payload ||
      typeof payload.suggestedName !== 'string' ||
      !(payload.bytes instanceof Uint8Array) ||
      payload.bytes.byteLength > 2_147_483_647 ||
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
    if (typeof recoveryId !== 'string' || recoveryId.length > 128) {
      throw new Error('Invalid LightTable recovery removal request.');
    }
    await recoveryStore.removeRecord(recoveryId);
  });

  ipcMain.handle('lighttable:recovery-read', async (event, recoveryId: string) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    rejectPendingAgentRequests('LightTable is closing.');
    void agentAccessBridge?.disable();
    packagedRendererServer?.close();
    packagedRendererServer = null;
    app.quit();
  }
});
