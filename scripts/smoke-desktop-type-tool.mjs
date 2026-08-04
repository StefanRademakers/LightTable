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
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'type-tool-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');

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
  const dialog = page.getByRole('dialog', { name: 'Create text' });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.getByRole('textbox', { name: 'Text' }).fill('Point gesture');
  await dialog.getByRole('button', { name: 'Create' }).click();
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
    || afterCreation.history.undoDepth !== before.history.undoDepth + 2) {
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
    || after.history.undoDepth !== before.history.undoDepth + 4) {
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
  await page.screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({ sourceFile, before, after, transformed, repeated, duplicated, pageErrors, screenshotPath, transformScreenshotPath, verticalScreenshotPath }, null, 2)}\n`);
  process.stdout.write(`Type Tool smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
