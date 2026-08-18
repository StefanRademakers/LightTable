import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const packagedDesktopExecutable = (
  workspaceRoot,
  platform = process.platform,
  architecture = process.arch
) => {
  if (platform === 'win32') {
    return path.join(
      workspaceRoot, 'apps', 'desktop', 'out',
      `LightTable-win32-${architecture}`, 'LightTable.exe'
    );
  }
  if (platform === 'darwin') {
    return path.join(
      workspaceRoot, 'apps', 'desktop', 'out',
      `LightTable-darwin-${architecture}`, 'LightTable.app', 'Contents', 'MacOS', 'LightTable'
    );
  }
  return path.join(
    workspaceRoot, 'apps', 'desktop', 'out',
    `LightTable-linux-${architecture}`, 'LightTable'
  );
};

export const resolveDesktopTestLaunch = async (
  workspaceRoot,
  { requirePackaged = false } = {}
) => {
  const packagedExecutable = process.env.LIGHTTABLE_TEST_EXECUTABLE
    ?? (requirePackaged ? packagedDesktopExecutable(workspaceRoot) : null);
  const executablePath = packagedExecutable
    ? path.resolve(packagedExecutable)
    : path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  await access(executablePath);
  return {
    executablePath,
    args: packagedExecutable ? [] : [path.join(workspaceRoot, 'apps', 'desktop')],
    mode: packagedExecutable ? 'production-packaged' : 'development-electron'
  };
};

export const captureDesktopTestState = async ({
  app,
  page,
  outputDirectory,
  sourceFile,
  pageErrors = [],
  label = 'desktop',
  timeout = null,
  details = {}
}) => {
  await mkdir(outputDirectory, { recursive: true });
  const suffix = `${label}-${process.pid}-${Date.now()}`;
  const diagnosticPath = path.join(outputDirectory, `runtime-state-${suffix}.json`);
  const screenshot = path.join(outputDirectory, `runtime-state-${suffix}.png`);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    bounds: window.getBounds(),
    destroyed: window.isDestroyed(),
    visible: window.isVisible(),
    webContents: {
      crashed: window.webContents.isCrashed(),
      destroyed: window.webContents.isDestroyed(),
      loading: window.webContents.isLoading(),
      url: window.webContents.getURL()
    }
  }))).catch((reason) => ({ diagnosticError: String(reason) }));
  await page.screenshot({ path: screenshot }).catch(() => {});
  await writeFile(diagnosticPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFile,
    timeout,
    page: {
      url: page.url(),
      title: await page.title().catch(() => ''),
      bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 8_000),
      buttons: await page.getByRole('button').allTextContents().catch(() => [])
    },
    pageErrors,
    windows,
    details,
    screenshot
  }, null, 2)}\n`, 'utf8');
  return diagnosticPath;
};

export const waitForDesktopLauncher = async ({
  app,
  page,
  outputDirectory,
  sourceFile,
  pageErrors = [],
  label = 'desktop',
  timeout = 30_000
}) => {
  const openFileButton = page.getByRole('button', { name: 'Open', exact: true });
  try {
    await openFileButton.waitFor({ state: 'visible', timeout });
    return openFileButton;
  } catch (error) {
    const diagnosticPath = await captureDesktopTestState({
      app, page, outputDirectory, sourceFile, pageErrors, label, timeout
    });
    throw new Error(`LightTable launcher was not ready within ${timeout / 1000} seconds. Diagnostic: ${diagnosticPath}`, {
      cause: error
    });
  }
};
