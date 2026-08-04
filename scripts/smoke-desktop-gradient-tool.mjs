import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'gradient-tool-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'gradient-tool.png');
const pixelScreenshotPath = path.join(outputDirectory, 'gradient-tool-pixels.png');
const reportPath = path.join(outputDirectory, 'gradient-tool.json');

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
  const driver = await attachLightTableAutomation(page, 'gradient-tool-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');

  await page.keyboard.press('g');
  const gradientButton = page.getByRole('button', { name: 'Gradient (G)', exact: true });
  await gradientButton.waitFor({ state: 'visible' });
  const iconSource = await gradientButton.locator('img').getAttribute('src');
  await page.getByRole('button', { name: 'Show gradient and fill tools' }).click();
  const bucketIconSource = await page.getByRole('toolbar', { name: 'Gradient and fill tools' })
    .getByRole('button', { name: 'Paint bucket', exact: true }).locator('img').getAttribute('src');
  if (!iconSource || iconSource === bucketIconSource) {
    throw new Error('Gradient and Paint Bucket still use the same icon.');
  }
  await page.locator('.lighttable-tool-options__identity').click();
  await page.getByRole('combobox', { name: 'Gradient type' }).selectOption('radial');
  await page.getByRole('combobox', { name: 'Gradient type' }).selectOption('linear');
  await page.getByRole('button', { name: 'Edit gradient' }).click();
  const editor = page.getByRole('dialog', { name: 'Gradient editor' });
  await editor.waitFor({ state: 'visible' });
  const ramp = editor.locator('.lighttable-style-gradient__preview');
  const colorStops = editor.locator('.lighttable-style-gradient__stop--color');
  if (await colorStops.count() !== 2) throw new Error('The default gradient needs two color stops.');
  const rampBounds = await ramp.boundingBox();
  if (!rampBounds) throw new Error('The gradient ramp is unavailable.');
  await page.mouse.dblclick(
    rampBounds.x + rampBounds.width * 0.68,
    rampBounds.y + rampBounds.height * 0.5
  );
  if (await colorStops.count() !== 3) throw new Error('Double-click did not add a color stop.');
  const addedStop = editor.locator('.lighttable-style-gradient__stop--color.lighttable-style-gradient__stop--active');
  const addedBounds = await addedStop.boundingBox();
  if (!addedBounds) throw new Error('The added gradient stop is unavailable.');
  await page.mouse.move(addedBounds.x + addedBounds.width / 2, addedBounds.y + addedBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(rampBounds.x + rampBounds.width * 0.35, addedBounds.y + addedBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  if (await addedStop.getAttribute('aria-label') !== 'Color stop 35%') {
    throw new Error('Dragging did not update the gradient-stop location.');
  }
  await addedStop.click({ button: 'right' });
  if (await colorStops.count() !== 2) throw new Error('Right-click did not remove the gradient stop.');
  await page.getByRole('button', { name: 'Close gradient' }).click();

  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  await page.keyboard.down('Alt');
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.classList.contains('lighttable-viewport--eyedropper'));
  await page.mouse.click(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.18);
  await page.keyboard.up('Alt');

  const start = { x: bounds.x + bounds.width * 0.14, y: bounds.y + bounds.height * 0.20 };
  const end = { x: bounds.x + bounds.width * 0.37, y: bounds.y + bounds.height * 0.42 };
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.screenshot({ path: screenshotPath });

  const after = await driver.queryDocument(documentId);
  const layers = await driver.queryLayers(documentId) ?? [];
  const activeLayer = layers.find(({ id }) => id === after?.activeLayerId);
  if (!after || after.layerCount !== before.layerCount + 1
    || after.history.undoDepth !== before.history.undoDepth + 1
    || activeLayer?.type !== 'vector') {
    throw new Error(`Gradient drag did not commit one editable vector layer: ${JSON.stringify({
      before,
      after,
      activeLayer,
      pageErrors,
      body: await page.locator('body').innerText()
    })}`);
  }

  await page.keyboard.press('Shift+g');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('g');
  await gradientButton.waitFor({ state: 'visible' });
  await page.keyboard.press('Control+z');
  const undone = await driver.queryDocument(documentId);
  if (!undone || undone.layerCount !== before.layerCount) {
    throw new Error('Ctrl+Z did not remove the Gradient Fill layer.');
  }

  const backgroundLayer = page.locator('.lighttable-layer').filter({
    has: page.locator('.lighttable-layer__name[value="Background"]')
  }).first();
  await backgroundLayer.click();
  await page.getByRole('combobox', { name: 'Gradient application' }).selectOption('pixels');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.screenshot({ path: pixelScreenshotPath });
  const pixelFilled = await driver.queryDocument(documentId);
  if (!pixelFilled
    || pixelFilled.layerCount !== before.layerCount
    || pixelFilled.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Pixel-gradient drag did not create one reversible raster edit: ${JSON.stringify({
      before,
      pixelFilled,
      body: await page.locator('body').innerText()
    })}`);
  }
  await page.keyboard.press('Control+z');
  const pixelUndone = await driver.queryDocument(documentId);
  if (!pixelUndone || pixelUndone.history.undoDepth !== before.history.undoDepth) {
    throw new Error('Ctrl+Z did not undo the pixel gradient.');
  }
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    iconSource,
    bucketIconSource,
    createdLayerId: activeLayer.id,
    screenshotPath,
    pixelScreenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Gradient Tool smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
