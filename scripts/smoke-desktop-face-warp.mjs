import { createHash } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\pukkels-lighttable.png');
const output = path.join(root, 'tmp', 'face-warp-smoke');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([access(sourceFile), mkdir(output, { recursive: true }), rm(userData, {
  recursive: true, force: true
}), mkdir(userData, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const changedPixelBounds = async (beforeBytes, afterBytes) => {
  const [before, after] = await Promise.all([
    sharp(beforeBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(afterBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    throw new Error('Face Warp comparison images have different dimensions.');
  }
  let changed = 0;
  let minX = before.info.width;
  let minY = before.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < before.info.height; y += 1) {
    for (let x = 0; x < before.info.width; x += 1) {
      const offset = (y * before.info.width + x) * 4;
      let difference = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        difference = Math.max(difference, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
      }
      if (difference <= 2) continue;
      changed += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { changed, minX, minY, maxX, maxY, width: before.info.width, height: before.info.height };
};
let page;
const pageErrors = [];
const consoleErrors = [];
try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile, pageErrors, label: 'face-warp'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'face-warp-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active Face Warp document.');

  await page.getByRole('button', { name: /^Face Warp/ }).click();
  await page.getByRole('button', { name: 'Detect faces' }).click();
  await page.getByRole('button', { name: 'Redetect faces' })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const viewport = page.locator('.lighttable-viewport');
  const canvas = page.locator('.lighttable-viewport__canvas');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Face Warp viewport bounds are unavailable.');
  // Texture assertions must not accidentally pass because only the debug mesh
  // or brush cursor changed. Hide presentation-only overlays for the oracle.
  await page.getByLabel('Show mesh').uncheck();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  const beforeBytes = await canvas.screenshot({ path: path.join(output, '01-detected.png') });
  const before = await driver.queryDocument(documentId);
  // Keep the gesture on the left cheek, clear of the default floating Layers
  // panel that covers the geometric center of this fixture.
  const center = { x: bounds.x + bounds.width * 0.40, y: bounds.y + bounds.height * 0.54 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 28, center.y - 16, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(250);
  const afterBytes = await canvas.screenshot({ path: path.join(output, '02-deformed.png') });
  const after = await driver.queryDocument(documentId);
  if (!before || !after || after.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Face Warp drag was not one undo transaction: ${JSON.stringify({ before, after })}`);
  }
  if (digest(beforeBytes) === digest(afterBytes)) {
    throw new Error('Face Warp drag did not visibly change the canvas.');
  }
  const changedBounds = await changedPixelBounds(beforeBytes, afterBytes);
  const changedArea = Math.max(0, changedBounds.maxX - changedBounds.minX + 1)
    * Math.max(0, changedBounds.maxY - changedBounds.minY + 1);
  if (changedBounds.changed < 16) throw new Error('Face Warp changed too few texture pixels.');
  if (changedArea > changedBounds.width * changedBounds.height * 0.6) {
    throw new Error(`Face Warp escaped its local face/collar region: ${JSON.stringify(changedBounds)}`);
  }
  // A released gesture must remain the authored result. This specifically
  // guards against stale pointer-up refinement or render-state resync making
  // the mesh/texture spring back after the initial interactive frame.
  await page.waitForTimeout(1_000);
  const settledBytes = await canvas.screenshot({ path: path.join(output, '03-settled.png') });
  if (digest(afterBytes) !== digest(settledBytes)) {
    throw new Error('Face Warp changed after pointer release instead of remaining settled.');
  }
  const body = await page.locator('body').innerText();
  if (/render validation failed|runtime error|stopped unexpectedly/i.test(body)) {
    throw new Error('Face Warp produced a visible renderer/runtime failure.');
  }
  if (pageErrors.length || consoleErrors.some((message) => /validation|invalid renderpipeline/i.test(message))) {
    throw new Error(`Face Warp runtime errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  const report = {
    sourceFile,
    beforeHash: digest(beforeBytes),
    afterHash: digest(afterBytes),
    settledHash: digest(settledBytes),
    beforeUndoDepth: before.history.undoDepth,
    afterUndoDepth: after.history.undoDepth,
    changedBounds,
    pageErrors,
    consoleErrors
  };
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Face Warp desktop smoke passed: ${path.join(output, 'report.json')}\n`);
} catch (error) {
  const diagnostics = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    body: page ? await page.locator('body').innerText().catch(() => '') : '',
    pageErrors,
    consoleErrors
  };
  await writeFile(path.join(output, 'failure.json'), `${JSON.stringify(diagnostics, null, 2)}\n`);
  throw error;
} finally {
  await app.close().catch(() => {});
}
