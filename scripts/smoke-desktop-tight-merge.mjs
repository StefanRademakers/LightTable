import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6\\EHS-396\\EHS-396\\EHS-396.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const outputDirectory = path.join(workspaceRoot, 'tmp', 'tight-merge');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'tight-merge-redo.png');
const reportPath = path.join(outputDirectory, 'tight-merge.json');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
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
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory,
    sourceFile, pageErrors, label: 'tight-merge' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'tight-merge');

  const before = await page.evaluate(() => {
    const driver = window.__lightTableAutomation;
    if (!driver) throw new Error('Automation driver is unavailable.');
    const documentId = driver.queryWorkspace().activeDocumentId;
    if (!documentId) throw new Error('No active document.');
    const documentState = driver.queryDocument(documentId);
    const layers = driver.queryLayers(documentId) ?? [];
    if (!documentState?.canvas) throw new Error('The document canvas is unavailable.');
    const candidates = layers.flatMap((top, index) => {
      const bottom = layers[index - 1];
      const tight = bottom?.rasterSurface
        && (bottom.rasterSurface.width !== documentState.canvas.width
          || bottom.rasterSurface.height !== documentState.canvas.height);
      return bottom && tight && top.type === 'raster' && bottom.type === 'raster'
        && top.parentId === bottom.parentId
        && document.querySelector(`[data-layer-id="${top.id}"]`)
        ? [{ bottom, top }]
        : [];
    });
    if (!candidates.length) throw new Error('No visible tight raster merge pair was found.');
    return { documentId, document: documentState, layers, pair: candidates[0] };
  });

  await page.locator(`[data-layer-id="${before.pair.top.id}"]`).click();
  await page.keyboard.press('Control+e');
  await page.waitForFunction(({ documentId, count }) => {
    const driver = window.__lightTableAutomation;
    return (driver?.queryLayers(documentId)?.length ?? 0) === count - 1;
  }, { documentId: before.documentId, count: before.layers.length }, { timeout: 10_000 });

  const afterMerge = await page.evaluate((documentId) => {
    const driver = window.__lightTableAutomation;
    const document = driver?.queryDocument(documentId);
    const layers = driver?.queryLayers(documentId) ?? [];
    return { document, layers, active: layers.find(({ id }) => id === document?.activeLayerId) };
  }, before.documentId);
  const expectedSurface = {
    width: before.document.canvas.width,
    height: before.document.canvas.height,
    offsetX: 0,
    offsetY: 0
  };
  if (JSON.stringify(afterMerge.active?.rasterSurface) !== JSON.stringify(expectedSurface)) {
    throw new Error(`Merged destination is not full-canvas: ${JSON.stringify(afterMerge.active)}`);
  }
  if ([before.pair.bottom.id, before.pair.top.id].includes(afterMerge.active.id)) {
    throw new Error('Merge reused and overwrote a tight source runtime.');
  }

  await driver.execute(before.documentId, 'history.undo', {});
  const afterUndo = await page.evaluate((documentId) => ({
    document: window.__lightTableAutomation?.queryDocument(documentId),
    layers: window.__lightTableAutomation?.queryLayers(documentId) ?? []
  }), before.documentId);
  if (!afterUndo.layers.some(({ id }) => id === before.pair.bottom.id)
    || !afterUndo.layers.some(({ id }) => id === before.pair.top.id)) {
    throw new Error('Undo did not restore both tight source layers.');
  }

  await driver.execute(before.documentId, 'history.redo', {});
  const afterRedo = await page.evaluate((documentId) => ({
    document: window.__lightTableAutomation?.queryDocument(documentId),
    layers: window.__lightTableAutomation?.queryLayers(documentId) ?? []
  }), before.documentId);
  if (!afterRedo.layers.some(({ id }) => id === afterMerge.active.id)) {
    throw new Error('Redo did not restore the baked destination.');
  }
  await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
  await page.locator('.lighttable-viewport').screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    pair: before.pair,
    merged: afterMerge.active,
    undoLayerCount: afterUndo.layers.length,
    redoLayerCount: afterRedo.layers.length,
    pageErrors,
    screenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Tight raster merge smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
