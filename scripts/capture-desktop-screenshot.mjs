import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const desktopAppPath = path.join(workspaceRoot, 'apps', 'desktop');
const defaultExecutable = path.join(
  workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe'
);

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const sourceFile = path.resolve(argument('file', 'D:\\TextTest.psd'));
const outputFile = path.resolve(argument(
  'output',
  path.join(workspaceRoot, 'tmp', 'screenshots', 'desktop-text-test.png')
));
const executablePath = path.resolve(argument('executable', defaultExecutable));
const reportFile = outputFile.replace(/\.[^.]+$/, '.json');
const userDataPath = path.join(workspaceRoot, 'tmp', 'playwright-user-data');

await Promise.all([access(sourceFile), access(executablePath)]).catch((error) => {
  throw new Error(
    `Screenshot prerequisites are missing. Build the desktop app and check the input path.\n${error}`
  );
});
await Promise.all([
  mkdir(path.dirname(outputFile), { recursive: true }),
  mkdir(userDataPath, { recursive: true })
]);

const diagnostics = {
  sourceFile,
  outputFile,
  executablePath,
  capturedAt: new Date().toISOString(),
  console: [],
  pageErrors: [],
  layers: [],
  status: '',
  debugPanel: '',
  runtime: null
};
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

let electronApp;
let window;
let failure;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [desktopAppPath],
    cwd: workspaceRoot,
    env: {
      ...launchEnvironment,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
      LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
    },
    timeout: 30_000
  });
  window = await electronApp.firstWindow({ timeout: 30_000 });
  window.on('console', (message) => diagnostics.console.push({
    type: message.type(),
    text: message.text()
  }));
  window.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack ?? error.message));

  await window.getByRole('button', { name: 'Open file' }).click();
  await window.getByRole('tab', { name: /TextTest\.psd/i }).waitFor({
    state: 'visible',
    timeout: 30_000
  });
  await window.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await window.locator('.lighttable-toolbar__meta')
    .filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 30_000 });

  await window.waitForFunction(() => {
    const status = document.querySelector('.lighttable-toolbar__status')?.textContent ?? '';
    return !status.includes('Preparing the text engine');
  }, undefined, { timeout: 15_000 }).catch(() => {});
  await window.waitForTimeout(750);

  diagnostics.layers = await window.locator('.lighttable-layer').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.lighttable-layer__name')?.value ?? '',
    statuses: [...row.querySelectorAll('.lighttable-layer__text-status')]
      .map((status) => status.textContent?.trim() ?? '')
      .filter(Boolean)
  })));
  diagnostics.status = await window.locator('.lighttable-toolbar__status').textContent() ?? '';
  diagnostics.runtime = await window.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webGpuAvailable: Boolean(navigator.gpu),
    canvasCount: document.querySelectorAll('canvas').length,
    documentTitle: document.querySelector('.lighttable-document-tab--active')?.textContent?.trim() ?? ''
  }));
  const debugTab = window.getByRole('tab', { name: 'Debug' });
  if (await debugTab.count()) {
    await debugTab.click();
    diagnostics.debugPanel = await window.getByRole('region', { name: 'LightTable debug log' })
      .textContent() ?? '';
    const textTab = window.getByRole('tab', { name: 'Text', exact: true });
    if (await textTab.count()) await textTab.click();
  }

  const flowLayers = diagnostics.layers.filter(({ statuses }) => statuses.includes('Flow'));
  const incompatible = diagnostics.layers.filter(({ statuses }) => statuses.some((status) =>
    /substituted|unavailable|raster/i.test(status)
  ));
  if (flowLayers.length !== 3) {
    throw new Error(`Expected 3 editable flow-text layers, found ${flowLayers.length}.`);
  }
  if (incompatible.length > 0) {
    throw new Error(`Imported text is not exact: ${JSON.stringify(incompatible)}.`);
  }
  if (/text-renderer is unavailable/i.test(diagnostics.status)) {
    throw new Error(diagnostics.status);
  }
} catch (error) {
  failure = error;
  diagnostics.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (window && !window.isClosed()) {
    await window.screenshot({ path: outputFile }).catch((error) => {
      diagnostics.screenshotError = String(error);
    });
  }
  await writeFile(reportFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
  await electronApp?.close().catch(() => {});
}

if (failure) throw failure;
console.info(`LightTable screenshot: ${outputFile}`);
console.info(`LightTable diagnostics: ${reportFile}`);
