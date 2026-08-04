import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'shape-geometry-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const screenshotPath = path.join(output, 'ellipse-pixels.png');
await Promise.all([access(sourceFile), access(executablePath), mkdir(output, { recursive: true })]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(root, 'apps', 'desktop')],
  cwd: root,
  env: {
    ...env,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`)
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'shape-geometry');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  await driver.execute(documentId, 'layer.createRaster', {});
  const baseline = await driver.queryDocument(documentId);
  if (!baseline) throw new Error('No raster baseline.');

  await page.keyboard.press('u');
  await page.getByLabel('Shape geometry mode').selectOption('fixed');
  const geometry = page.locator('[aria-label="Shape geometry"]');
  const number = (label) => geometry.locator('.lighttable-tool-options__weight-field')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('input');
  await number('W').fill('160');
  await number('H').fill('90');
  await number('Radius').fill('18');
  await page.getByLabel('Stroke style').selectOption('dotted');
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('No viewport bounds.');
  const start = { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height * 0.25 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y + 20, { steps: 3 });
  await page.mouse.up();
  const rectangle = await driver.queryDocument(documentId);
  if (!rectangle
    || rectangle.layerCount !== baseline.layerCount + 1
    || rectangle.history.undoDepth !== baseline.history.undoDepth + 1) {
    throw new Error(`Fixed rectangle was not one editable command: ${JSON.stringify({ baseline, rectangle })}`);
  }
  await page.keyboard.press('Control+z');

  const shapeButton = page.locator('.lighttable-toolbox__group').filter({
    has: page.getByRole('button', { name: 'Rectangle (U)' })
  }).getByRole('button', { name: 'Rectangle (U)' });
  await shapeButton.click();
  await page.getByRole('toolbar', { name: 'Shape tools' })
    .getByRole('button', { name: 'Ellipse (Shift+U)' }).click();
  await page.getByLabel('Shape application mode').selectOption('pixels');
  await page.getByLabel('Shape geometry mode').selectOption('proportional');
  await number('W').fill('4');
  await number('H').fill('3');
  await page.waitForTimeout(50);
  await page.mouse.move(start.x, start.y + 260);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 340, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const pixels = await driver.queryDocument(documentId);
  if (!pixels
    || pixels.layerCount !== baseline.layerCount
    || pixels.history.undoDepth !== baseline.history.undoDepth + 1) {
    throw new Error(`Ellipse Pixels mode was not atomic: ${JSON.stringify({ baseline, pixels })}`);
  }
  await page.screenshot({ path: screenshotPath });
  await page.keyboard.press('Control+z');
  const undone = await driver.queryDocument(documentId);
  if (!undone
    || undone.layerCount !== baseline.layerCount
    || undone.history.undoDepth !== baseline.history.undoDepth) {
    throw new Error(`Ellipse Pixels undo was not atomic: ${JSON.stringify({ baseline, undone })}`);
  }
  if (errors.length) throw new Error(`Page errors: ${JSON.stringify(errors)}`);
  const reportPath = path.join(output, 'report.json');
  await writeFile(reportPath, `${JSON.stringify({ sourceFile, screenshotPath, errors }, null, 2)}\n`);
  process.stdout.write(`Shape geometry smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
