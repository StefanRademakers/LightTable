import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const baseDirectory = path.join(workspaceRoot, 'tmp', 'brush-ux-smoke');
await mkdir(baseDirectory, { recursive: true });
const outputDirectory = await mkdtemp(path.join(baseDirectory, 'run-'));
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'brush-ux.png');
const reportPath = path.join(outputDirectory, 'brush-ux.json');

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

const pageErrors = []; let page;
try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory,
    sourceFile, pageErrors, label: 'brush-ux' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'brush-ux-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  await driver.execute(documentId, 'layer.createRaster', {});

  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Brush (B)', exact: true }).waitFor({ state: 'visible' });
  const beforeSettings = await driver.queryDocument(documentId);
  await page.keyboard.press('d');
  await page.keyboard.press('5');
  await page.keyboard.press('Shift+3');
  const toolbar = page.locator('.lighttable-tool-options');
  assert.equal(await toolbar.getByRole('slider', { name: 'Opacity', exact: true }).inputValue(), '50');
  assert.equal(await toolbar.getByRole('slider', { name: 'Flow', exact: true }).inputValue(), '30');

  await page.keyboard.press('F5');
  const settings = page.getByRole('dialog', { name: 'Tool settings' });
  await settings.waitFor({ state: 'visible' });
  for (const label of ['Opacity', 'Flow', 'Size', 'Hardness']) {
    assert.equal(await settings.getByRole('slider', { name: label, exact: true }).inputValue(),
      await toolbar.getByRole('slider', { name: label, exact: true }).inputValue(), `${label} must share defaults`);
  }
  const dialogSize = settings.getByRole('slider', { name: 'Size', exact: true });
  const oldSize = Number(await dialogSize.inputValue());
  await dialogSize.press('ArrowRight');
  assert.ok(Number(await dialogSize.inputValue()) > oldSize);
  const changedSize = await dialogSize.inputValue();
  await page.keyboard.press('Escape');
  assert.equal(await toolbar.getByRole('slider', { name: 'Size', exact: true }).inputValue(), changedSize);
  const afterSettings = await driver.queryDocument(documentId);
  assert.equal(afterSettings.canonicalRevision, beforeSettings.canonicalRevision, 'Settings must not author document state');
  assert.deepEqual(afterSettings.history, beforeSettings.history, 'Settings must not create history');
  const pixels = async label => {
    const accepted = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, accepted.taskId);
    const artifact = await driver.readArtifact(task.artifact.id);
    await writeFile(path.join(outputDirectory, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const beforePaint = await pixels('before-paint');

  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  // Keep both points in the unobstructed left side of the canvas; imported
  // documents can restore a floating Layers panel over the right half.
  const first = { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height * 0.32 };
  const second = { x: bounds.x + bounds.width * 0.38, y: bounds.y + bounds.height * 0.58 };
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');
  await page.mouse.click(first.x, first.y);
  const afterFirst = await driver.queryDocument(documentId);
  if (!afterFirst || afterFirst.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`The first Brush click did not commit: ${JSON.stringify({ before, afterFirst })}`);
  }
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  const after = await driver.queryDocument(documentId);
  if (!after || after.history.undoDepth !== afterFirst.history.undoDepth + 1) {
    throw new Error(`Shift-click did not commit a connected brush stroke: ${JSON.stringify({ afterFirst, after })}`);
  }
  const afterPaint = await pixels('after-paint');
  assert.notDeepEqual(afterPaint, beforePaint, 'Actual strokes must change final pixels');
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual(await pixels('undo-two-strokes'), beforePaint);
  await driver.execute(documentId, 'history.redo', {});
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual(await pixels('redo-two-strokes'), afterPaint);

  const presetControl = page.getByLabel('Brush preset');
  const presetNames = { round: 'Round', airbrush: 'Airbrush', 'ink-pen': 'Ink Pen',
    calligraphy: 'Calligraphy', 'rough-ink': 'Rough Ink', blur: 'Blur', liquify: 'Liquify' };
  const choosePreset = async presetId => {
    await presetControl.click();
    await page.getByRole('option', { name: presetNames[presetId], exact: true }).click();
  };
  const sizeControl = page.getByRole('slider', { name: 'Size' });
  for (const presetId of ['round', 'airbrush', 'ink-pen', 'calligraphy', 'rough-ink', 'blur', 'liquify']) {
    await choosePreset(presetId);
    await page.evaluate(() => document.activeElement instanceof HTMLElement
      && document.activeElement.blur());
    const initialSize = Number(await sizeControl.inputValue());
    await page.keyboard.press('BracketRight');
    await page.waitForFunction(({ control, initialSize }) => Number(control.value) > initialSize,
      { control: await sizeControl.elementHandle(), initialSize }, { timeout: 3000 });
    const enlargedSize = Number(await sizeControl.inputValue());
    if (!(enlargedSize > initialSize)) {
      throw new Error(`] did not enlarge the ${presetId} brush: ${initialSize} -> ${enlargedSize}`);
    }
    await page.keyboard.press('BracketLeft');
  }

  const commitPresetGesture = async (presetId) => {
    await choosePreset(presetId);
    await page.evaluate(() => document.activeElement instanceof HTMLElement
      && document.activeElement.blur());
    const beforeGesture = await driver.queryDocument(documentId);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(second.x, second.y, { steps: 8 });
    await page.mouse.up();
    const afterGesture = await driver.queryDocument(documentId);
    if (!beforeGesture || !afterGesture
      || afterGesture.history.undoDepth !== beforeGesture.history.undoDepth + 1) {
      throw new Error(`${presetId} did not commit one gesture: ${JSON.stringify({
        beforeGesture, afterGesture
      })}`);
    }
  };
  await commitPresetGesture('blur');
  await commitPresetGesture('liquify');

  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'CapsLock', bubbles: true });
    Object.defineProperty(event, 'getModifierState', { value: (key) => key === 'CapsLock' });
    window.dispatchEvent(event);
  });
  await viewport.evaluate((element) => {
    if (!element.classList.contains('lighttable-viewport--precise-brush')) {
      throw new Error('Caps Lock did not activate the precise Brush cursor.');
    }
  });

  await page.keyboard.down('Alt');
  await viewport.evaluate((element) => {
    if (!element.classList.contains('lighttable-viewport--eyedropper')) {
      throw new Error('Alt did not activate the temporary eyedropper.');
    }
  });
  await page.mouse.click(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.20);
  await page.keyboard.up('Alt');
  await page.screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    executablePath: launch.executablePath,
    passed: true,
    sharedToolbarDialogDefaults: true,
    settingsNoDocumentRevisionOrHistory: true,
    exactPaintUndoRedoPixels: true,
    beforeUndoDepth: before.history.undoDepth,
    afterUndoDepth: after.history.undoDepth,
    screenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Brush UX smoke passed. Report: ${reportPath}\n`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(outputDirectory, 'failure.png') });
  await writeFile(reportPath, JSON.stringify({ passed: false, error: error.stack ?? String(error),
    sourceFile, executablePath: launch.executablePath, pageErrors }, null, 2));
  throw error;
} finally {
  await app.close().catch(() => {});
}
