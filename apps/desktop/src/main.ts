import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { createServer, type Server } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopSavePayload } from './desktopBridge';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'psd', 'psb'
];

let mainWindow: BrowserWindow | null = null;
let rendererOrigin = '';
let packagedRendererServer: Server | null = null;

const NAVIGATION_ABORTED = -3;

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
      sandbox: true
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
  });
  window.once('ready-to-show', () => window.show());

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

  ipcMain.handle('lighttable:open-file', async (event) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    const options: Electron.OpenDialogOptions = {
      title: 'Open in LightTable',
      properties: ['openFile'],
      filters: [
        { name: 'Supported images and documents', extensions: [...IMAGE_EXTENSIONS, 'lighttable.png'] },
        { name: 'All files', extensions: ['*'] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return null;

    const bytes = await readFile(selectedPath);
    return {
      name: path.basename(selectedPath),
      type: '',
      bytes: new Uint8Array(bytes)
    };
  });

  ipcMain.handle('lighttable:save-file', async (event, payload: DesktopSavePayload) => {
    assertTrustedSender(senderUrlOrThrow(event.senderFrame));
    if (
      !payload ||
      typeof payload.suggestedName !== 'string' ||
      !(payload.bytes instanceof Uint8Array) ||
      payload.bytes.byteLength > 2_147_483_647
    ) {
      throw new Error('Invalid LightTable save request.');
    }

    const options: Electron.SaveDialogOptions = {
      title: 'Save from LightTable',
      defaultPath: payload.suggestedName
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, payload.bytes);
    return true;
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
    packagedRendererServer?.close();
    packagedRendererServer = null;
    app.quit();
  }
});
