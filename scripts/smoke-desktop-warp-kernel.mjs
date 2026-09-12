import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? path.join(root, 'architecture', 'ui', '1.png'));
const output = path.join(root, 'tmp', 'warp-kernel-smoke');
await Promise.all([access(sourceFile), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const consoleErrors = [];
const report = { sourceFile, previewChangedPixels: [], moveDurationsMs: [] };
let app;

const rawPreview = async (driver, documentId) => {
  const state = await driver.queryDocument(documentId);
  const request = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 768);
  assert.equal(request?.status, 'completed', JSON.stringify(request));
  const artifact = await driver.readArtifact(request?.artifact?.id ?? request?.id);
  assert.ok(artifact?.bytes?.length, 'Warp preview artifact is empty.');
  return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};

const changedPixels = (before, after, tolerance = 2, ignoreCircle = null) => {
  assert.equal(before.info.width, after.info.width);
  assert.equal(before.info.height, after.info.height);
  let changed = 0;
  let maximumDifference = 0;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % before.info.width;
    const y = Math.floor(pixel / before.info.width);
    if (ignoreCircle && Math.hypot(x - ignoreCircle.x, y - ignoreCircle.y) <= ignoreCircle.radius) {
      continue;
    }
    let difference = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      difference = Math.max(difference, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
    }
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > tolerance) changed += 1;
  }
  return { changed, maximumDifference };
};

const visibleCanvas = async (canvas) => (
  sharp(await canvas.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
);

try {
  app = await electron.launch({
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
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile, pageErrors, label: 'warp-kernel'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'warp-kernel-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  assert.ok(documentId, 'No active Warp document.');
  await driver.waitForReadyDocument(documentId, 60_000);
  const initial = await driver.queryDocument(documentId);
  const canonicalBaseline = await rawPreview(driver, documentId);
  const waitForRenderIdle = async (minimumFrames) => {
    const deadline = Date.now() + 20_000;
    let previous = -1;
    let stableFrames = 0;
    while (Date.now() < deadline) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      const submitted = (await driver.queryRenderTelemetry(documentId))?.submittedFrames ?? 0;
      stableFrames = submitted >= minimumFrames && submitted === previous ? stableFrames + 1 : 0;
      if (stableFrames >= 2) return;
      previous = submitted;
    }
    throw new Error('Warp renderer did not settle.');
  };
  const executeAndWaitForFrame = async (command) => {
    const openingFrames = (await driver.queryRenderTelemetry(documentId))?.submittedFrames ?? 0;
    await driver.execute(documentId, command, {});
    await waitForRenderIdle(openingFrames + 1);
  };

  await page.getByRole('button', { name: 'Warp', exact: true }).click();
  await page.getByText('Mode', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const sizeControl = page.getByRole('slider', { name: 'Size', exact: true });
  await sizeControl.fill('120');
  const viewport = page.locator('.lighttable-viewport');
  const canvasSurface = page.locator('.lighttable-viewport__canvas');
  const bounds = await viewport.boundingBox();
  const canvasBounds = await canvasSurface.boundingBox();
  assert.ok(bounds, 'Warp viewport bounds are unavailable.');
  assert.ok(canvasBounds, 'Warp canvas bounds are unavailable.');
  const canvas = initial.canvas;
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height) * 0.94;
  const documentBounds = {
    x: bounds.x + (bounds.width - canvas.width * scale) / 2,
    y: bounds.y + (bounds.height - canvas.height * scale) / 2,
    width: canvas.width * scale,
    height: canvas.height * scale
  };
  const point = (x, y) => ({
    x: documentBounds.x + documentBounds.width * x,
    y: documentBounds.y + documentBounds.height * y
  });
  const start = point(0.38, 0.48);
  const end = point(0.62, 0.54);
  await page.mouse.move(2, 2);
  const visibleBaseline = await visibleCanvas(canvasSurface);
  await driver.resetRenderTelemetry(documentId);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= 8; index += 1) {
    const sample = {
      x: start.x + (end.x - start.x) * index / 8,
      y: start.y + (end.y - start.y) * index / 8
    };
    const startedAt = performance.now();
    await page.mouse.move(sample.x, sample.y);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    report.moveDurationsMs.push(performance.now() - startedAt);
    const preview = await visibleCanvas(canvasSurface);
    const screenshotScaleX = preview.info.width / canvasBounds.width;
    const screenshotScaleY = preview.info.height / canvasBounds.height;
    report.previewChangedPixels.push(changedPixels(visibleBaseline, preview, 2, {
      x: (sample.x - canvasBounds.x) * screenshotScaleX,
      y: (sample.y - canvasBounds.y) * screenshotScaleY,
      radius: 85 * Math.max(screenshotScaleX, screenshotScaleY)
    }).changed);
  }
  const framesBeforeCommit = (await driver.queryRenderTelemetry(documentId))?.submittedFrames ?? 0;
  await page.mouse.up();
  await page.waitForFunction(({ id, depth }) => (
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth
  ), { id: documentId, depth: initial.history.undoDepth + 1 }, { timeout: 20_000 });
  await waitForRenderIdle(framesBeforeCommit + 1);

  const visiblyChanged = report.previewChangedPixels.findIndex((count) => count > 100);
  assert.ok(visiblyChanged >= 0, `Warp never produced a visible preview: ${report.previewChangedPixels}`);
  assert.ok(report.previewChangedPixels.slice(visiblyChanged).every((count) => count > 100),
    `Warp preview rebounded to its unwarped source: ${report.previewChangedPixels}`);
  const committed = await rawPreview(driver, documentId);
  assert.ok(changedPixels(canonicalBaseline, committed).changed > 100, 'Committed Warp is visually unchanged.');

  await executeAndWaitForFrame('history.undo');
  const undone = await rawPreview(driver, documentId);
  assert.ok(changedPixels(canonicalBaseline, undone).changed <= 2, 'Warp undo did not restore the opening pixels.');
  await executeAndWaitForFrame('history.redo');
  const redone = await rawPreview(driver, documentId);
  const redoDifference = changedPixels(committed, redone);
  report.redoDifference = redoDifference;
  await Promise.all([
    sharp(committed.data, { raw: committed.info }).png().toFile(path.join(output, 'committed.png')),
    sharp(redone.data, { raw: redone.info }).png().toFile(path.join(output, 'redone.png')),
    sharp(undone.data, { raw: undone.info }).png().toFile(path.join(output, 'undone.png')),
    writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  ]);
  assert.ok(redoDifference.changed <= 2, `Warp redo did not restore the committed pixels: ${JSON.stringify(redoDifference)}`);

  // A second stroke keeps the same Warp runtime alive across undo/redo. This
  // proves history cannot accidentally reuse the incremental preview path.
  const secondStart = point(0.52, 0.66);
  const secondEnd = point(0.46, 0.38);
  const beforeSecond = await driver.queryDocument(documentId);
  await page.mouse.move(secondStart.x, secondStart.y);
  await page.mouse.down();
  await page.mouse.move(secondEnd.x, secondEnd.y, { steps: 8 });
  const framesBeforeSecondCommit = (await driver.queryRenderTelemetry(documentId))?.submittedFrames ?? 0;
  await page.mouse.up();
  await page.waitForFunction(({ id, depth }) => (
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth
  ), { id: documentId, depth: beforeSecond.history.undoDepth + 1 }, { timeout: 20_000 });
  await waitForRenderIdle(framesBeforeSecondCommit + 1);
  const secondCommitted = await rawPreview(driver, documentId);
  assert.ok(changedPixels(committed, secondCommitted).changed > 100,
    'Second Warp stroke is visually unchanged.');
  await executeAndWaitForFrame('history.undo');
  const secondUndone = await rawPreview(driver, documentId);
  assert.ok(changedPixels(committed, secondUndone).changed <= 2,
    'Undo of the second Warp stroke did not restore stroke A.');
  await executeAndWaitForFrame('history.redo');
  const secondRedone = await rawPreview(driver, documentId);
  report.secondStrokeRedoDifference = changedPixels(secondCommitted, secondRedone);
  assert.ok(report.secondStrokeRedoDifference.changed <= 2,
    `Second Warp redo was not pixel exact: ${JSON.stringify(report.secondStrokeRedoDifference)}`);

  const beforeCancel = await driver.queryDocument(documentId);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const afterCancel = await driver.queryDocument(documentId);
  const cancelled = await rawPreview(driver, documentId);
  assert.equal(afterCancel.history.undoDepth, beforeCancel.history.undoDepth,
    'Cancelled Warp created history.');
  assert.ok(changedPixels(secondCommitted, cancelled).changed <= 2,
    'Cancelled Warp did not restore the committed source.');

  report.renderTelemetry = await driver.queryRenderTelemetry(documentId);
  report.history = afterCancel.history;
  report.pageErrors = pageErrors;
  report.consoleErrors = consoleErrors;
  assert.deepEqual(pageErrors, [], `Warp page errors: ${pageErrors.join('\n')}`);
  await page.screenshot({ path: path.join(output, 'final.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => undefined);
}
