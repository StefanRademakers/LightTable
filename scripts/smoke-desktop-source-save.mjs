import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'source-save-smoke');
const sourceFile = path.join(outputDirectory, 'source.png');
const layeredTarget = path.join(outputDirectory, 'source-lighttable.png');
const userData = path.join(outputDirectory, `user-data-${process.pid}`);
await mkdir(userData, { recursive: true });
await rm(layeredTarget, { force: true });
await sharp({
  create: { width: 64, height: 48, channels: 4, background: '#c06040ff' }
}).png().toFile(sourceFile);
const originalBytes = await readFile(sourceFile);

const pngDimensions = (bytes) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20)
});
const waitFor = async (predicate, message, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};

const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let page = null;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_SAVE_FILE: layeredTarget,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'source-save'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'source-save-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('The opened document is unavailable.');

  await driver.execute(documentId, 'document.resizeImage', {
    width: 32,
    height: 24,
    resolutionPpi: 72,
    resample: true,
    method: 'automatic',
    preserveDetailsNoiseReduction: 0,
    scaleStyles: true
  });
  await page.keyboard.press('Control+S');
  await waitFor(async () => {
    const dimensions = pngDimensions(await readFile(sourceFile));
    return dimensions.width === 32 && dimensions.height === 24;
  }, 'Save did not replace the original PNG with the resized raster.');
  await waitFor(async () => {
    const document = await driver.queryDocument(documentId);
    return document?.tasks.activeCount === 0 && document.dirty === false;
  }, 'The flat source save did not commit its clean revision.');
  const flatBytes = await readFile(sourceFile);
  if (flatBytes.equals(originalBytes)) throw new Error('The source PNG was not changed.');
  try {
    await access(layeredTarget);
    throw new Error('The flat source save incorrectly used the Save As target.');
  } catch (reason) {
    if (reason instanceof Error && !('code' in reason && reason.code === 'ENOENT')) throw reason;
  }

  await driver.execute(documentId, 'layer.createRaster', {});
  await page.keyboard.press('Control+S');
  await waitFor(async () => {
    try { return (await stat(layeredTarget)).size > 8; } catch { return false; }
  }, 'A layered document did not fall back to the LightTable Save As route.');
  await waitFor(async () => {
    const document = await driver.queryDocument(documentId);
    return document?.tasks.activeCount === 0 && document.dirty === false;
  }, 'The layered fallback save did not commit its clean revision.');
  const sourceAfterLayeredSave = await readFile(sourceFile);
  if (!sourceAfterLayeredSave.equals(flatBytes)) {
    throw new Error('A layered save overwrote the original flat PNG.');
  }

  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  console.log(JSON.stringify({
    passed: true,
    source: { path: sourceFile, dimensions: pngDimensions(flatBytes), bytes: flatBytes.length },
    layered: { path: layeredTarget, bytes: (await stat(layeredTarget)).size }
  }, null, 2));
} finally {
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.lightTableDesktop.closeApplication()).catch(() => {});
  }
  await app.close().catch(() => {});
}
