import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'type-tool-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'type-tool.png');
const transformScreenshotPath = path.join(outputDirectory, 'text-free-transform.png');
const verticalScreenshotPath = path.join(outputDirectory, 'vertical-type.png');
const reportPath = path.join(outputDirectory, 'type-tool.json');
let performanceTelemetry = null;

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
  const openFileButton = page.getByRole('button', { name: 'Open file' });
  try {
    await openFileButton.waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const diagnosticPath = path.join(outputDirectory, `startup-failure-${process.pid}.json`);
    const screenshot = path.join(outputDirectory, `startup-failure-${process.pid}.png`);
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
      bounds: window.getBounds(),
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
      webContents: {
        crashed: window.webContents.isCrashed(),
        destroyed: window.webContents.isDestroyed(),
        loading: window.webContents.isLoading(),
        url: window.webContents.getURL()
      }
    }))).catch((reason) => ({ diagnosticError: String(reason) }));
    await page.screenshot({ path: screenshot }).catch(() => {});
    await writeFile(diagnosticPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      sourceFile,
      page: {
        url: page.url(),
        title: await page.title().catch(() => ''),
        bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 8_000)
      },
      pageErrors,
      windows,
      screenshot
    }, null, 2)}\n`, 'utf8');
    throw new Error(`LightTable launcher was not ready within 30 seconds. Diagnostic: ${diagnosticPath}`, {
      cause: error
    });
  }
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'type-tool-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');
  await page.evaluate(() => {
    globalThis.__LIGHTTABLE_TEXT_INPUT_TRACE__ = true;
    globalThis.__LIGHTTABLE_TEXT_INTERACTION_TRACE__ = true;
  });

  await page.keyboard.press('t');
  const typeButton = page.getByRole('button', { name: 'Type tool (T)', exact: true });
  await typeButton.waitFor({ state: 'visible' });
  if (await typeButton.getAttribute('aria-pressed') !== 'true') {
    throw new Error('T did not activate the unified Type Tool.');
  }
  await page.getByRole('button', { name: 'Show text tools' }).click();
  const family = page.getByRole('toolbar', { name: 'Text tools' });
  const familyTypeButton = family.getByRole('button', { name: 'Type tool (T)', exact: true });
  const pathTextButton = family.getByRole('button', { name: 'Path text', exact: true });
  const verticalTypeButton = family.getByRole('button', { name: 'Vertical type tool (Shift+T)', exact: true });
  await familyTypeButton.waitFor({ state: 'visible' });
  await pathTextButton.waitFor({ state: 'visible' });
  await verticalTypeButton.waitFor({ state: 'visible' });
  const typeIcon = await familyTypeButton.locator('img').getAttribute('src');
  const pathIcon = await pathTextButton.locator('img').getAttribute('src');
  const verticalIcon = await verticalTypeButton.locator('img').getAttribute('src');
  if (!typeIcon || !pathIcon || !verticalIcon || typeIcon === pathIcon
    || typeIcon === verticalIcon || pathIcon === verticalIcon) {
    throw new Error('Type, Vertical Type and Path Text do not have distinct icons.');
  }
  if (await family.getByRole('button', { name: 'Paragraph text', exact: true }).count()) {
    throw new Error('Paragraph text is still exposed as a separate tool.');
  }
  await page.locator('.lighttable-tool-options__identity').click();
  await page.keyboard.press('Shift+t');
  if (await page.getByRole('button', { name: 'Vertical type tool (Shift+T)', exact: true })
    .getAttribute('aria-pressed') !== 'true') {
    throw new Error('Shift+T did not activate Vertical Type.');
  }
  await page.keyboard.press('Shift+t');
  if (await typeButton.getAttribute('aria-pressed') !== 'true') {
    throw new Error('Shift+T did not cycle back to horizontal Type.');
  }
  const authoringSize = page.locator('.lighttable-tool-options').getByLabel('Size');
  await authoringSize.fill('48');
  await authoringSize.press('Enter');

  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  const point = { x: bounds.x + bounds.width * 0.30, y: bounds.y + bounds.height * 0.30 };
  await page.mouse.click(point.x, point.y);
  const textInput = page.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached', timeout: 30_000 });
  if (await page.getByRole('dialog', { name: 'Create text' }).count()) {
    throw new Error('Point text still opened the legacy creation dialog.');
  }
  await textInput.pressSequentially('Point gesture');
  await textInput.press('Backspace');
  if (await textInput.inputValue() !== 'Point gestur') {
    throw new Error('Backspace did not delete the previous text grapheme.');
  }
  await textInput.pressSequentially('e');
  await textInput.press('Control+Backspace');
  if (await textInput.inputValue() !== 'Point ') {
    throw new Error('Ctrl+Backspace did not delete the previous text word.');
  }
  await textInput.pressSequentially('gesture');
  await page.getByRole('radio', { name: 'Convert to point text' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  if (await page.getByRole('radio', { name: 'Convert to point text' }).getAttribute('aria-checked') !== 'true') {
    throw new Error('A Type Tool click did not create point text.');
  }

  const dragStart = { x: bounds.x + bounds.width * 0.22, y: bounds.y + bounds.height * 0.72 };
  const dragEnd = { x: dragStart.x + 220, y: dragStart.y + 130 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('radio', { name: 'Convert to paragraph text' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  if (await page.getByRole('radio', { name: 'Convert to paragraph text' }).getAttribute('aria-checked') !== 'true') {
    throw new Error('A Type Tool drag did not create paragraph text.');
  }
  const afterCreation = await driver.queryDocument(documentId);
  if (!afterCreation || afterCreation.layerCount !== before.layerCount + 2
    || afterCreation.history.undoDepth !== before.history.undoDepth + 7) {
    throw new Error(`Unified Type gestures produced unexpected history: ${JSON.stringify({ before, afterCreation })}`);
  }
  const orientation = page.locator('.lighttable-tool-options').getByLabel('Orientation');
  await orientation.selectOption('vertical-rl');
  const verticalLayers = await driver.queryLayers(documentId);
  const verticalLayer = verticalLayers?.find(({ id }) => id === afterCreation.activeLayerId);
  if (!verticalLayer || verticalLayer.textLayout?.writingMode !== 'vertical-rl') {
    throw new Error(`Orientation did not update semantic text: ${JSON.stringify(verticalLayer)}`);
  }
  await page.screenshot({ path: verticalScreenshotPath });
  await orientation.selectOption('horizontal-tb');

  const after = await driver.queryDocument(documentId);
  if (!after || after.layerCount !== before.layerCount + 2
    || after.history.undoDepth !== before.history.undoDepth + 9) {
    throw new Error(`Text orientation produced unexpected history: ${JSON.stringify({ before, after })}`);
  }
  const beforeTransformLayers = await driver.queryLayers(documentId);
  const activeBeforeTransform = beforeTransformLayers?.find(({ id }) => id === after.activeLayerId);
  if (!activeBeforeTransform || activeBeforeTransform.type !== 'text') {
    throw new Error('The paragraph text layer is not the active transform target.');
  }
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+t');
  const transformOverlay = page.getByLabel('Transform controls');
  await transformOverlay.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('Free Transform properties').waitFor({ state: 'visible' });
  await page.screenshot({ path: transformScreenshotPath });
  const firstHandle = transformOverlay.locator('rect').first();
  const handleBox = await firstHandle.boundingBox();
  if (!handleBox) throw new Error('The text transform handle is unavailable.');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 24, handleBox.y - 18, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await transformOverlay.waitFor({ state: 'detached', timeout: 30_000 });
  const transformed = await driver.queryDocument(documentId);
  const transformedLayers = await driver.queryLayers(documentId);
  const activeTransformed = transformedLayers?.find(({ id }) => id === after.activeLayerId);
  if (!transformed || transformed.history.undoDepth !== after.history.undoDepth + 1
    || !activeTransformed
    || JSON.stringify(activeTransformed.transform) === JSON.stringify(activeBeforeTransform.transform)) {
    throw new Error(`Text Free Transform was not committed semantically: ${JSON.stringify({
      after,
      transformed,
      activeBeforeTransform,
      activeTransformed
    })}`);
  }
  await page.keyboard.press('Control+t');
  await transformOverlay.waitFor({ state: 'visible', timeout: 30_000 });
  const transformHandleBounds = await transformOverlay.locator('rect').evaluateAll((rectangles) => (
    rectangles
      .map((rectangle) => rectangle.getBoundingClientRect())
      .filter(({ width, height }) => width > 0 && height > 0 && width <= 24 && height <= 24)
      .map(({ x, y, width, height }) => ({ x, y, width, height }))
  ));
  if (transformHandleBounds.length < 2) {
    throw new Error('The transformed text handles are unavailable.');
  }
  const transformedBounds = transformHandleBounds.reduce((bounds, handle) => ({
    left: Math.min(bounds.left, handle.x + handle.width / 2),
    top: Math.min(bounds.top, handle.y + handle.height / 2),
    right: Math.max(bounds.right, handle.x + handle.width / 2),
    bottom: Math.max(bounds.bottom, handle.y + handle.height / 2)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  await page.keyboard.press('Escape');
  await transformOverlay.waitFor({ state: 'detached', timeout: 30_000 });
  await page.keyboard.press('t');
  await page.mouse.click(
    (transformedBounds.left + transformedBounds.right) / 2,
    (transformedBounds.top + transformedBounds.bottom) / 2
  );
  await textInput.waitFor({ state: 'attached', timeout: 30_000 });
  const reopened = await driver.queryDocument(documentId);
  if (reopened?.activeLayerId !== after.activeLayerId) {
    throw new Error('A Type Tool click did not re-enter the transformed text layer.');
  }
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+Shift+t');
  const repeated = await driver.queryDocument(documentId);
  const repeatedLayers = await driver.queryLayers(documentId);
  const activeRepeated = repeatedLayers?.find(({ id }) => id === after.activeLayerId);
  if (!repeated || repeated.history.undoDepth !== transformed.history.undoDepth + 1
    || !activeRepeated
    || JSON.stringify(activeRepeated.transform) === JSON.stringify(activeTransformed.transform)) {
    throw new Error('Ctrl+Shift+T did not repeat the semantic text transform.');
  }
  await page.keyboard.press('Control+Alt+Shift+t');
  const duplicated = await driver.queryDocument(documentId);
  if (!duplicated || duplicated.layerCount !== repeated.layerCount + 1
    || duplicated.history.undoDepth !== repeated.history.undoDepth + 1) {
    throw new Error('Ctrl+Alt+Shift+T did not duplicate and repeat as one command.');
  }
  await page.getByRole('tab', { name: 'Debug', exact: true }).click();
  const debugText = await page.locator('.lighttable-debug-panel').innerText();
  const latency = debugText.match(
    /Text input:\s*(\d+) samples\D+submit p95\s*([\d.]+) ms\s*\/\s*max\s*([\d.]+) ms\D+GPU p95\s*([\d.]+) ms\s*\/\s*max\s*([\d.]+) ms/i
  );
  performanceTelemetry = latency ? {
    status: 'available',
    samples: Number(latency[1]),
    inputToSubmitP95Ms: Number(latency[2]),
    inputToSubmitMaxMs: Number(latency[3]),
    inputToGpuP95Ms: Number(latency[4]),
    inputToGpuMaxMs: Number(latency[5])
  } : { status: 'unavailable', reason: 'The Debug panel did not expose text latency samples.' };
  if (performanceTelemetry.status !== 'available' || performanceTelemetry.samples < 1) {
    throw new Error(`Type Tool latency sample is invalid: ${JSON.stringify(performanceTelemetry)}`);
  }
  await page.getByRole('tab', { name: 'Text', exact: true }).click();
  await page.screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({ sourceFile, before, after, transformed, repeated, duplicated, performanceTelemetry, pageErrors, screenshotPath, transformScreenshotPath, verticalScreenshotPath }, null, 2)}\n`);
  process.stdout.write(`Type Tool smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
