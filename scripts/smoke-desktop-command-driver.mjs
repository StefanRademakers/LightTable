import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'command-driver');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'command-driver.png');
const reportPath = path.join(outputDirectory, 'command-driver.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__lightTableAutomation), undefined, {
    timeout: 10_000
  });

  const report = await page.evaluate(async () => {
    const driver = window.__lightTableAutomation;
    if (!driver) throw new Error('Automation driver is unavailable.');
    const workspace = driver.queryWorkspace();
    const documentId = workspace.activeDocumentId;
    if (!documentId) throw new Error('No active document.');
    const before = driver.queryDocument(documentId);
    const layersBefore = driver.queryLayers(documentId) ?? [];
    const activeLayer = layersBefore.find(({ id }) => id === before?.activeLayerId);
    if (!activeLayer) throw new Error('No active layer projection.');
    let sequence = 0;
    const execute = (command, parameters) => driver.execute({
      protocolVersion: 1,
      requestId: `smoke-${++sequence}`,
      command,
      documentId,
      parameters
    });

    const zoom = await execute('view.setZoom', { mode: 'custom', percent: 175 });
    const hidden = await execute('layer.setVisibility', {
      layerIds: [activeLayer.id], visible: false
    });
    const shown = await execute('layer.setVisibility', {
      layerIds: [activeLayer.id], visible: true
    });
    const created = await execute('layer.createRaster', {});
    const createdId = driver.queryDocument(documentId)?.activeLayerId;
    if (!createdId) throw new Error('Raster command did not select a layer.');
    const renamed = await execute('layer.rename', {
      layerId: createdId, name: 'Command driver layer'
    });
    const undone = await execute('history.undo', {});
    return {
      workspace,
      before,
      layersBefore: layersBefore.length,
      results: { zoom, hidden, shown, created, renamed, undone },
      after: driver.queryDocument(documentId),
      layersAfter: driver.queryLayers(documentId)
    };
  });

  await page.screenshot({ path: screenshotPath });
  const rejected = Object.values(report.results).filter((result) => result.status !== 'completed');
  if (rejected.length || pageErrors.length) {
    throw new Error(`Command driver smoke failed: ${JSON.stringify({ rejected, pageErrors })}`);
  }
  await writeFile(reportPath, `${JSON.stringify({ ...report, pageErrors, screenshotPath }, null, 2)}\n`);
  process.stdout.write(`Command driver smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}

