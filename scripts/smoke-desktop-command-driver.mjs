import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

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
  const driver = await attachLightTableAutomation(page, 'command-smoke');
  const semanticCreate = await driver.executeWorkspace('document.create', {
    name: 'Command canvas', width: 320, height: 240, resolutionPpi: 144,
    bitDepth: 16, profile: 'adobe-rgb-1998', background: { kind: 'solid', color: '#112233' }
  });
  const semanticDocumentId = semanticCreate.value?.documentId;
  if (!semanticDocumentId) throw new Error('Semantic document creation returned no stable ID.');
  const makeImageBytes = async (mediaType) => Buffer.from(await page.evaluate(async (type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 3;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.fillStyle = '#f40'; context.fillRect(0, 0, 4, 3);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(`Could not encode ${type}.`)), type, 0.9
    ));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, mediaType));
  const placements = [];
  for (const [mediaType, extension, x] of [
    ['image/png', 'png', -1], ['image/jpeg', 'jpg', 8], ['image/webp', 'webp', 16]
  ]) {
    const artifact = await driver.registerInputArtifact(
      await makeImageBytes(mediaType), `placed.${extension}`, mediaType
    );
    if (!artifact?.id) throw new Error(`${mediaType} artifact registration failed.`);
    placements.push(await driver.execute(semanticDocumentId, 'layer.placeArtifact', {
      artifactId: artifact.id, name: `Placed ${extension}`, x, y: 24
    }));
  }
  const placedLayers = await driver.queryLayers(semanticDocumentId);
  if (placements.some(({ status }) => status !== 'completed') || !placedLayers?.some((layer) => layer.name === 'Placed png'
    && layer.rasterSurface?.width > 0 && layer.transform?.tx === -1)) {
    throw new Error('Placed image media, bounds or transform were not preserved.');
  }
  const nativeExport = await driver.execute(semanticDocumentId, 'file.exportNative', {}, { requireCompleted: false });
  const nativeTask = await driver.waitForTask(semanticDocumentId, nativeExport.taskId);
  const psdExport = await driver.execute(semanticDocumentId, 'file.exportPsd', {}, { requireCompleted: false });
  const psdTask = await driver.waitForTask(semanticDocumentId, psdExport.taskId);
  if (!nativeTask.artifact || !psdTask.artifact) throw new Error('Placed document exports did not complete.');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.documents.find(({ title }) => title === path.basename(sourceFile))?.id;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  const layerProjection = await driver.queryLayers(documentId) ?? [];
  const activeLayer = layerProjection.find(({ id }) => id === before?.activeLayerId);
  if (!activeLayer) throw new Error('No active layer projection.');
  const zoom = await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 175 });
  const hidden = await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [activeLayer.id], visible: false
  });
  const shown = await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [activeLayer.id], visible: true
  });
  const created = await driver.execute(documentId, 'layer.createRaster', {});
  const createdId = (await driver.queryDocument(documentId))?.activeLayerId;
  if (!createdId) throw new Error('Raster command did not select a layer.');
  const renamed = await driver.execute(documentId, 'layer.rename', {
    layerId: createdId, name: 'Command driver layer'
  });
  const undone = await driver.execute(documentId, 'history.undo', {});
  const pngExport = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
  if (pngExport.status !== 'accepted') throw new Error('PNG artifact export was not accepted.');
  const pngTask = await driver.waitForTask(documentId, pngExport.taskId);
  if (!pngTask.artifact) throw new Error('PNG artifact task did not publish an artifact.');

  const runGesture = async (request, samples) => {
    const started = await driver.beginGesture(request);
    if (started?.status !== 'started') throw new Error(`Gesture did not start: ${JSON.stringify(started)}`);
    await driver.updateGesture(started.gestureId, samples);
    return driver.finishGesture(started.gestureId, true);
  };
  const translated = await runGesture({
    documentId, kind: 'layer-translate', coordinateSpace: 'document',
    parameters: { layerId: createdId }, sample: { x: 20, y: 20 }
  }, [{ x: 32, y: 27 }]);
  const selected = await runGesture({
    documentId, kind: 'selection-rectangle', coordinateSpace: 'document',
    parameters: { mode: 'replace' }, sample: { x: 20, y: 20 }
  }, [{ x: 120, y: 100 }]);
  const painted = await runGesture({
    documentId, kind: 'brush-stroke', coordinateSpace: 'document',
    parameters: { layerId: createdId, channel: 'pixels' }, sample: { x: 50, y: 50, pressure: 1 }
  }, [{ x: 90, y: 75, pressure: 0.8 }]);
  const report = {
    workspace, semantic: { create: semanticCreate, placements, layers: placedLayers,
      exports: { native: nativeTask, psd: psdTask } },
    before, layersBefore: layerProjection.length,
    results: { zoom, hidden, shown, created, renamed, undone },
    artifactExport: { accepted: pngExport, task: pngTask },
    gestures: { translated, selected, painted },
    after: await driver.queryDocument(documentId),
    layersAfter: await driver.queryLayers(documentId)
  };

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
