import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(
  process.argv[2]
  ?? path.join(workspaceRoot, '..', 'LightTableTestFiles', 'RandomFiles', 'shapes.psd')
);
const baseDirectory = path.join(workspaceRoot, 'tmp', 'selection-dimensions-smoke');
await mkdir(baseDirectory, { recursive: true });
const outputDirectory = await mkdtemp(path.join(baseDirectory, 'run-'));
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'ellipse-dimensions.png');
const lassoScreenshotPath = path.join(outputDirectory, 'lasso-settings.png');
const horizontalScreenshotPath = path.join(outputDirectory, 'horizontal-strip.png');
const verticalScreenshotPath = path.join(outputDirectory, 'vertical-strip.png');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
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

let page;
const pageErrors = [];
try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory, sourceFile,
    pageErrors, label: 'selection-dimensions' });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'selection-dimensions');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  assert.ok(documentId, 'Selection dimensions smoke has no active document.');
  const documentState = await driver.queryDocument(documentId);
  assert.ok(documentState?.canvas, 'Selection dimensions smoke has no document canvas.');
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');

  await page.keyboard.press('Shift+m');
  await page.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Elliptical selection' })
    .waitFor({ state: 'visible' });
  const marqueeSettings = page.locator('[aria-label="Marquee selection settings"]');
  await marqueeSettings.waitFor({ state: 'visible' });
  if (await page.getByText('Snap to pixels', { exact: true }).count()) {
    throw new Error('The always-on marquee pixel snap control is still visible.');
  }
  await marqueeSettings.locator('label').filter({ hasText: 'Feather' }).locator('input').fill('6');
  await page.getByLabel('Marquee selection style').click();
  await page.getByRole('option', { name: 'Fixed', exact: true }).click();
  await marqueeSettings.locator('label').filter({ hasText: 'Width' }).locator('input').fill('40');
  await marqueeSettings.locator('label').filter({ hasText: 'Height' }).locator('input').fill('25');
  const ellipseHistoryBefore = (await driver.queryDocument(documentId)).history.undoDepth;
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.55, { steps: 5 });
  const ellipseMetrics = await page.locator('.lighttable-selection__dimensions').textContent() ?? '';
  for (const label of ['W:', 'H:', 'X:', 'Y:']) {
    if (!ellipseMetrics.includes(label)) throw new Error(`Ellipse dimensions omit ${label}`);
  }
  if (!ellipseMetrics.includes('W: 40') || !ellipseMetrics.includes('H: 25')) {
    throw new Error(`Fixed ellipse dimensions are incorrect: ${ellipseMetrics}`);
  }
  await page.screenshot({ path: screenshotPath });
  await page.mouse.up();
  await page.waitForFunction(({ documentId, undoDepth }) => (
    window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth + 1
  ), { documentId, undoDepth: ellipseHistoryBefore }, { timeout: 30_000 });

  const exerciseStrip = async ({ toolName, sizeLabel, size, expectedMetric, screenshot }) => {
    await page.keyboard.press('Shift+m');
    await page.locator('.lighttable-tool-options__identity')
      .filter({ hasText: toolName })
      .waitFor({ state: 'visible' });
    const sizeField = page.locator('label.lighttable-tool-options__weight-field')
      .filter({ hasText: sizeLabel }).locator('input');
    await sizeField.fill(String(size));
    const beforeCommit = await driver.queryDocument(documentId);
    if (typeof beforeCommit?.history.undoDepth !== 'number') {
      throw new Error(`${toolName} could not read the active document history.`);
    }
    await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.55,
      { steps: 4 });
    const metrics = await page.locator('.lighttable-selection__dimensions').textContent() ?? '';
    if (!metrics.includes(expectedMetric)) {
      throw new Error(`${toolName} dimensions are incorrect: ${metrics}`);
    }
    await page.screenshot({ path: screenshot });
    await page.mouse.up();
    await page.waitForFunction(({ documentId, undoDepth }) => (
      window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth + 1
    ), { documentId, undoDepth: beforeCommit.history.undoDepth }, { timeout: 30_000 });
    const committed = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
    assert.equal(committed.status, 'completed', `${toolName} committed mask could not be copied.`);
    const committedBounds = committed.value?.bounds;
    assert.ok(committedBounds, `${toolName} committed mask has no bounds.`);
    if (sizeLabel === 'Height') {
      assert.equal(committedBounds.x, 0, `${toolName} does not start at the document left edge.`);
      assert.equal(committedBounds.width, documentState.canvas.width,
        `${toolName} does not span the full document width.`);
      assert.equal(committedBounds.height, size, `${toolName} committed height is incorrect.`);
    } else {
      assert.equal(committedBounds.y, 0, `${toolName} does not start at the document top edge.`);
      assert.equal(committedBounds.height, documentState.canvas.height,
        `${toolName} does not span the full document height.`);
      assert.equal(committedBounds.width, size, `${toolName} committed width is incorrect.`);
    }
    await page.keyboard.press('Control+z');
    await page.waitForFunction(({ documentId, undoDepth }) => {
      const history = window.__lightTableAutomation?.queryDocument(documentId)?.history;
      return history?.undoDepth === undoDepth && history.redoDepth >= 1;
    }, { documentId, undoDepth: beforeCommit.history.undoDepth }, { timeout: 30_000 });
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(({ documentId, undoDepth }) => (
      window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth + 1
    ), { documentId, undoDepth: beforeCommit.history.undoDepth }, { timeout: 30_000 });
    const redone = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
    assert.equal(redone.status, 'completed', `${toolName} redone mask could not be copied.`);
    assert.deepEqual(redone.value?.bounds, committedBounds,
      `${toolName} redo did not restore exact committed bounds.`);
    const error = (await page.locator('.lighttable-toolbar__status--error').allTextContents()).join('\n');
    if (error) throw new Error(`${toolName} failed: ${error}`);
  };

  await exerciseStrip({
    toolName: 'Horizontal selection', sizeLabel: 'Height', size: 3,
    expectedMetric: 'H: 3 px', screenshot: horizontalScreenshotPath
  });
  await exerciseStrip({
    toolName: 'Vertical selection', sizeLabel: 'Width', size: 4,
    expectedMetric: 'W: 4 px', screenshot: verticalScreenshotPath
  });

  await page.keyboard.press('l');
  await page.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Free selection' })
    .waitFor({ state: 'visible' });
  const lassoSettings = page.locator('[aria-label="Lasso selection settings"]');
  await lassoSettings.waitFor({ state: 'visible' });
  await lassoSettings.getByText('Smooth', { exact: true }).waitFor({ state: 'visible' });
  await lassoSettings.locator('label').filter({ hasText: 'Feather' }).locator('input').fill('4');
  await lassoSettings.locator('label').filter({ hasText: 'Anti-alias' }).locator('input').check();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.78, bounds.y + bounds.height * 0.65);
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.78);
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.65);
  await page.mouse.up();
  await page.screenshot({ path: lassoScreenshotPath });

  await page.keyboard.press('Shift+l');
  await page.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Polygonal selection' })
    .waitFor({ state: 'visible' });
  const polygonSettings = page.locator('[aria-label="Lasso selection settings"]');
  await polygonSettings.locator('label').filter({ hasText: 'Feather' }).waitFor({ state: 'visible' });
  await polygonSettings.locator('label').filter({ hasText: 'Anti-alias' }).waitFor({ state: 'visible' });
  if (await polygonSettings.getByText('Smooth', { exact: true }).count()) {
    throw new Error('Polygonal selection exposes freehand smoothing.');
  }
  const polygon = [
    { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height * 0.30 },
    { x: bounds.x + bounds.width * 0.42, y: bounds.y + bounds.height * 0.34 },
    { x: bounds.x + bounds.width * 0.34, y: bounds.y + bounds.height * 0.52 },
  ];
  for (const point of polygon) await page.mouse.click(point.x, point.y);
  await page.mouse.click(polygon[0].x, polygon[0].y);
  await page.waitForTimeout(250);
  const polygonError = (await page.locator('.lighttable-toolbar__status--error')
    .allTextContents()).join('\n');
  if (polygonError) throw new Error(`Polygon selection failed: ${polygonError}`);

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ passed: true,
    executablePath: launch.executablePath, sourceFile, pageErrors }, null, 2));
  process.stdout.write(
    `Selection dimensions smoke passed. Screenshots: ${screenshotPath}, ${horizontalScreenshotPath}, `
      + `${verticalScreenshotPath}, ${lassoScreenshotPath}\n`
  );
} catch (error) {
  if (page) await page.screenshot({ path: path.join(outputDirectory, 'failure.png') });
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ passed: false,
    executablePath: launch.executablePath, sourceFile, error: error.stack ?? String(error), pageErrors }, null, 2));
  throw error;
} finally {
  await app.close().catch(() => {});
}
