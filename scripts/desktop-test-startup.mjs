import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const waitForDesktopLauncher = async ({
  app,
  page,
  outputDirectory,
  sourceFile,
  pageErrors = [],
  label = 'desktop',
  timeout = 30_000
}) => {
  const openFileButton = page.getByRole('button', { name: 'Open file' });
  try {
    await openFileButton.waitFor({ state: 'visible', timeout });
    return openFileButton;
  } catch (error) {
    await mkdir(outputDirectory, { recursive: true });
    const suffix = `${label}-${process.pid}-${Date.now()}`;
    const diagnosticPath = path.join(outputDirectory, `startup-failure-${suffix}.json`);
    const screenshot = path.join(outputDirectory, `startup-failure-${suffix}.png`);
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
        bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 8_000)
      },
      pageErrors,
      windows,
      screenshot
    }, null, 2)}\n`, 'utf8');
    throw new Error(`LightTable launcher was not ready within ${timeout / 1000} seconds. Diagnostic: ${diagnosticPath}`, {
      cause: error
    });
  }
};
