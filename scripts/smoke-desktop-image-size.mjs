import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const fixtureName = path.basename(sourceFile, path.extname(sourceFile)).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
const outputDirectory = path.join(workspaceRoot, 'tmp', 'image-size-smoke', fixtureName);
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'image-size.png');
const resizedScreenshotPath = path.join(outputDirectory, 'image-size-resized.png');
const reportPath = path.join(outputDirectory, 'image-size.json');
await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env }; delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath, args: launch.args, cwd: workspaceRoot,
  env: { ...launchEnvironment, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile, LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory, sourceFile, pageErrors, label: 'image-size' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'image-size-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  const before = documentId ? await driver.queryDocument(documentId) : null;
  const beforeLayers = documentId ? await driver.queryLayers(documentId) : null;
  if (!documentId || !before?.canvas) throw new Error('The opening document is unavailable.');

  await page.keyboard.press('Control+Alt+i');
  const dialog = page.getByRole('dialog', { name: 'Image Size' });
  await dialog.waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });
  const width = dialog.getByLabel('Width', { exact: true });
  const height = dialog.getByLabel('Height', { exact: true });
  await width.fill(String(Math.max(1, Math.round(before.canvas.width / 2))));
  const linkedHeight = Number(await height.inputValue());
  if (linkedHeight !== Math.max(1, Math.round(before.canvas.height / 2))) {
    throw new Error(`Linked dimensions are incorrect: ${linkedHeight}.`);
  }
  await dialog.getByRole('combobox', { name: 'Resampling method' }).selectOption('bilinear');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(250);
  const after = await driver.queryDocument(documentId);
  const afterLayers = await driver.queryLayers(documentId);
  await page.screenshot({ path: resizedScreenshotPath });
  if (!after?.canvas || after.canvas.width !== Math.max(1, Math.round(before.canvas.width / 2))
    || after.canvas.height !== Math.max(1, Math.round(before.canvas.height / 2))
    || after.layerCount !== before.layerCount || after.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Image Size did not commit one layered document operation: ${JSON.stringify({ before, after })}`);
  }
  const semanticSignature = (layers) => layers?.map((layer) => ({
    id: layer.id,
    parentId: layer.parentId,
    type: layer.type,
    name: layer.name,
    textLayout: layer.textLayout,
    vectorKind: layer.vectorContent?.kind ?? null,
    vectorElementCount: layer.vectorContent?.elementCount ?? null,
    hasMask: layer.hasMask,
    hasActiveEffects: layer.hasActiveEffects
  }));
  if (JSON.stringify(semanticSignature(afterLayers)) !== JSON.stringify(semanticSignature(beforeLayers))) {
    throw new Error(`Image Size changed editable layer semantics: ${JSON.stringify({ beforeLayers, afterLayers })}`);
  }
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = await driver.queryDocument(documentId);
  const undoneLayers = await driver.queryLayers(documentId);
  if (!undone?.canvas || undone.canvas.width !== before.canvas.width || undone.canvas.height !== before.canvas.height) {
    throw new Error(`Image Size undo did not restore dimensions: ${JSON.stringify({ before, undone })}`);
  }
  if (JSON.stringify(undoneLayers) !== JSON.stringify(beforeLayers)) {
    throw new Error('Image Size undo did not restore the exact canonical layer projection.');
  }
  await driver.execute(documentId, 'document.resizeImage', {
    width: Math.max(1, Math.round(before.canvas.width / 2)),
    height: Math.max(1, Math.round(before.canvas.height / 2)),
    resolutionPpi: 144,
    resample: true,
    method: 'automatic',
    preserveDetailsNoiseReduction: 0,
    scaleStyles: true
  });
  await page.waitForTimeout(250);
  const commanded = await driver.queryDocument(documentId);
  if (commanded?.canvas?.width !== Math.max(1, Math.round(before.canvas.width / 2))
    || commanded.canvas.height !== Math.max(1, Math.round(before.canvas.height / 2))
    || commanded.history.undoDepth !== 1) {
    throw new Error(`Scriptable Image Size did not use the canonical resize path: ${JSON.stringify(commanded)}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile, before, after, undone, commanded, beforeLayers, afterLayers, undoneLayers,
    screenshotPath, resizedScreenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Image Size smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
