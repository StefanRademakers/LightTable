import { _electron as electron } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'architecture/ui/1.png');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'document-place-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(userDataPath, { recursive: true });

const launch = await resolveDesktopTestLaunch(workspaceRoot, { requirePackaged: true });
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
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
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'document-place'
  });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'document-place');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('The source document did not publish an active ID.');
  const before = await driver.waitForReadyDocument(documentId);
  const beforeLayers = await driver.waitForLayers(documentId);

  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Open Place...', exact: true }).click();
  await page.waitForFunction(({ id, count, depth }) => {
    const automation = window.__lightTableAutomation;
    return automation?.queryLayers(id)?.length === count + 1
      && automation?.queryDocument(id)?.history.undoDepth === depth + 1;
  }, {
    id: documentId,
    count: beforeLayers.length,
    depth: before.document.history.undoDepth
  }, { timeout: 30_000 });
  const placed = await driver.queryDocument(documentId);
  const placedLayers = await driver.queryLayers(documentId);
  const placedLayer = placedLayers?.find(({ id }) => !beforeLayers.some((layer) => layer.id === id));
  if (!placedLayer || placedLayer.type !== 'raster' || !placedLayer.rasterSurface
    || placedLayer.rasterSurface.width < 1 || placedLayer.rasterSurface.height < 1) {
    throw new Error(`Place did not publish one measurable raster layer: ${JSON.stringify(placedLayers)}`);
  }
  const placedPreview = await driver.requestDocumentPreview(
    documentId, placed.canonicalRevision, 512
  );
  const placedPreviewArtifact = await driver.readArtifact(
    placedPreview?.artifact?.id ?? placedPreview?.id
  );
  if (placedPreview?.status !== 'completed' || !placedPreviewArtifact?.bytes.length) {
    throw new Error(`Place did not produce a current rendered preview: ${JSON.stringify(placedPreview)}`);
  }

  await driver.execute(documentId, 'history.undo', {});
  const undoneLayers = await driver.queryLayers(documentId);
  if (undoneLayers?.some(({ id }) => id === placedLayer.id)) {
    throw new Error('Undo retained the placed layer.');
  }
  await driver.execute(documentId, 'history.redo', {});
  await page.waitForFunction(({ id, layerId }) =>
    window.__lightTableAutomation?.queryLayers(id)?.some((layer) => layer.id === layerId),
  { id: documentId, layerId: placedLayer.id }, { timeout: 30_000 });
  const redone = await driver.queryDocument(documentId);
  const redonePreview = await driver.requestDocumentPreview(
    documentId, redone.canonicalRevision, 512
  );
  if (redonePreview?.status !== 'completed') {
    throw new Error(`Redo did not produce a current rendered preview: ${JSON.stringify(redonePreview)}`);
  }

  if (pageErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(pageErrors)}`);
  console.log(JSON.stringify({
    passed: true,
    documentId,
    placedLayer: { id: placedLayer.id, name: placedLayer.name, surface: placedLayer.rasterSurface },
    revisions: {
      before: before.document.canonicalRevision,
      placed: placed.canonicalRevision,
      redone: redone.canonicalRevision
    },
    history: redone.history,
    previewBytes: placedPreviewArtifact.bytes.length
  }, null, 2));
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
  await app.close().catch(() => {});
}
