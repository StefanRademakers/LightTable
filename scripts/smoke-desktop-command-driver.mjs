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
    const pngExport = await execute('file.exportPng', {});
    if (pngExport.status !== 'accepted') throw new Error('PNG artifact export was not accepted.');
    let pngTask = driver.queryTask(documentId, pngExport.taskId);
    const deadline = Date.now() + 30_000;
    while (pngTask?.status === 'running' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      pngTask = driver.queryTask(documentId, pngExport.taskId);
    }
    if (pngTask?.status !== 'completed' || !pngTask.artifact) {
      throw new Error(`PNG artifact task failed: ${JSON.stringify(pngTask)}`);
    }
    const translate = await driver.beginGesture({
      documentId, kind: 'layer-translate', coordinateSpace: 'document',
      parameters: { layerId: createdId }, sample: { x: 20, y: 20 }
    });
    if (translate.status !== 'started') throw new Error(`Translate did not start: ${JSON.stringify(translate)}`);
    await driver.updateGesture(translate.gestureId, [{ x: 32, y: 27 }]);
    const translated = await driver.finishGesture(translate.gestureId, true);
    const selection = await driver.beginGesture({
      documentId, kind: 'selection-rectangle', coordinateSpace: 'document',
      parameters: { mode: 'replace' }, sample: { x: 20, y: 20 }
    });
    if (selection.status !== 'started') throw new Error(`Selection did not start: ${JSON.stringify(selection)}`);
    await driver.updateGesture(selection.gestureId, [{ x: 120, y: 100 }]);
    const selected = await driver.finishGesture(selection.gestureId, true);
    const brush = await driver.beginGesture({
      documentId, kind: 'brush-stroke', coordinateSpace: 'document',
      parameters: { layerId: createdId, channel: 'pixels' }, sample: { x: 50, y: 50, pressure: 1 }
    });
    if (brush.status !== 'started') throw new Error(`Brush did not start: ${JSON.stringify(brush)}`);
    await driver.updateGesture(brush.gestureId, [{ x: 90, y: 75, pressure: 0.8 }]);
    const painted = await driver.finishGesture(brush.gestureId, true);
    return {
      workspace,
      before,
      layersBefore: layersBefore.length,
      results: { zoom, hidden, shown, created, renamed, undone },
      artifactExport: { accepted: pngExport, task: pngTask },
      gestures: { translated, selected, painted },
      after: driver.queryDocument(documentId),
      layersAfter: driver.queryLayers(documentId)
    };
  });

  await page.screenshot({ path: screenshotPath });
  const rejected = Object.values(report.results).filter((result) => result.status !== 'completed');
  const rejectedGestures = Object.values(report.gestures).filter((result) => result.status !== 'completed');
  if (rejected.length || rejectedGestures.length || pageErrors.length) {
    throw new Error(`Command driver smoke failed: ${JSON.stringify({ rejected, rejectedGestures, pageErrors })}`);
  }
  await writeFile(reportPath, `${JSON.stringify({ ...report, pageErrors, screenshotPath }, null, 2)}\n`);
  process.stdout.write(`Command driver smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
