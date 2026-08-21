import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { createRgba16Png, createRgba16Tiff } from './native-bitmap-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'native-bitmap-save-smoke');
await mkdir(outputDirectory, { recursive: true });
const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const allCases = [
  { id: 'png', format: 'png', extension: 'png', depth: 'uchar', encode: (image) => image.png() },
  { id: 'jpeg', format: 'jpeg', extension: 'jpg', depth: 'uchar', encode: (image) => image.jpeg({ quality: 88 }) },
  { id: 'webp', format: 'webp', extension: 'webp', depth: 'uchar', encode: (image) => image.webp({ quality: 84 }) },
  { id: 'tiff', format: 'tiff', extension: 'tif', depth: 'uchar', encode: (image) => image.tiff({ compression: 'lzw' }) },
  { id: 'png16', format: 'png', extension: 'png', depth: 'ushort', bytes: () => createRgba16Png(64, 48) },
  { id: 'tiff16', format: 'tiff', extension: 'tif', depth: 'ushort', bytes: () => createRgba16Tiff(64, 48) }
];
const requestedCase = process.env.LIGHTTABLE_NATIVE_BITMAP_CASE;
const cases = requestedCase ? allCases.filter(({ id }) => id === requestedCase) : allCases;
if (!cases.length) throw new Error(`Unknown native bitmap case: ${requestedCase}`);

const waitFor = async (predicate, message, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};

const results = [];
for (const testCase of cases) {
  const sourceFile = path.join(outputDirectory, `source-${testCase.id}.${testCase.extension}`);
  const layeredTarget = path.join(outputDirectory, `${testCase.id}-layered.lighttable.png`);
  const userData = path.join(outputDirectory, `user-data-${testCase.id}-${process.pid}`);
  await rm(layeredTarget, { force: true });
  if (testCase.bytes) await writeFile(sourceFile, testCase.bytes());
  else await testCase.encode(sharp({
    create: { width: 64, height: 48, channels: 4, background: '#c06040ff' }
  })).toFile(sourceFile);
  const originalBytes = await readFile(sourceFile);
  const pageErrors = [];
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
    const page = await app.firstWindow({ timeout: 30_000 });
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(`[console:${message.type()}] ${message.text()}`);
      }
    });
    const open = await waitForDesktopLauncher({
      app, page, outputDirectory, sourceFile, pageErrors, label: `native-save-${testCase.id}`
    });
    await open.click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    const driver = await attachLightTableAutomation(page, `native-save-${testCase.id}`);
    const documentId = (await driver.queryWorkspace())?.activeDocumentId;
    if (!documentId) throw new Error(`The ${testCase.id} document is unavailable.`);

    await driver.execute(documentId, 'document.resizeImage', {
      width: 32, height: 24, resolutionPpi: 72, resample: true,
      method: 'automatic', preserveDetailsNoiseReduction: 0, scaleStyles: true
    });
    const saveStartedAt = performance.now();
    await page.keyboard.press('Control+S');
    const keypressMs = Math.round(performance.now() - saveStartedAt);
    const saveTimeline = [];
    let previousSaveState = '';
    try {
      await waitFor(async () => {
        const saveError = await page.locator('.lighttable-toolbar__status--error')
          .evaluateAll((nodes) => nodes[0]?.textContent ?? null);
        if (saveError) throw new Error(saveError);
        const documentState = await driver.queryDocument(documentId).catch(() => null);
        const toolbarStatus = await page.locator('.lighttable-toolbar__status')
          .evaluateAll((nodes) => nodes[0]?.textContent ?? null);
        const taskState = JSON.stringify(documentState?.tasks ?? null);
        const stateKey = `${toolbarStatus ?? ''}|${taskState}`;
        if (stateKey !== previousSaveState) {
          previousSaveState = stateKey;
          saveTimeline.push({ atMs: Math.round(performance.now() - saveStartedAt), toolbarStatus, tasks: documentState?.tasks ?? null });
        }
        try {
          const metadata = await sharp(sourceFile).metadata();
          return metadata.width === 32 && metadata.height === 24
            && metadata.format === testCase.format && metadata.depth === testCase.depth;
        } catch { return false; }
      }, `Save did not replace the original ${testCase.id} with a valid native file.`, 60_000);
    } catch (reason) {
      const body = (await page.locator('body').innerText().catch(() => '')).slice(-4_000);
      throw new Error(`${reason instanceof Error ? reason.message : String(reason)}\nUI: ${body}\n${pageErrors.join('\n')}`);
    }
    const flatBytes = await readFile(sourceFile);
    const saveMs = Math.round(performance.now() - saveStartedAt);
    if (flatBytes.equals(originalBytes)) throw new Error(`The source ${testCase.id} was not changed.`);
    try {
      await access(layeredTarget);
      throw new Error(`Flat ${testCase.id} save incorrectly used the Save As target.`);
    } catch (reason) {
      if (reason instanceof Error && !('code' in reason && reason.code === 'ENOENT')) throw reason;
    }

    if (testCase.id === 'png') {
      await driver.execute(documentId, 'layer.createRaster', {});
      await page.keyboard.press('Control+S');
      await waitFor(async () => {
        try { return (await stat(layeredTarget)).size > 8; } catch { return false; }
      }, 'A layered document did not fall back to the LightTable Save As route.');
      if (!(await readFile(sourceFile)).equals(flatBytes)) {
        throw new Error('A layered save overwrote the original flat PNG.');
      }
    }
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    const metadata = await sharp(flatBytes).metadata();
    results.push({
      case: testCase.id,
      format: testCase.format,
      dimensions: { width: metadata.width, height: metadata.height },
      bitDepth: metadata.depth,
      bytes: flatBytes.length,
      keypressMs,
      saveMs,
      saveTimeline
    });
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
}

console.log(JSON.stringify({ passed: true, formats: results }, null, 2));
