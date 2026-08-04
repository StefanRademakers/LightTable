import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'brush-ux-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'brush-ux.png');
const reportPath = path.join(outputDirectory, 'brush-ux.json');

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
  const driver = await attachLightTableAutomation(page, 'brush-ux-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  await driver.execute(documentId, 'layer.createRaster', {});

  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Brush' }).waitFor({ state: 'visible' });
  await page.keyboard.press('d');
  await page.keyboard.press('5');
  await page.keyboard.press('Shift+3');
  await page.locator('label.lighttable-adjustment').filter({ hasText: 'Opacity' })
    .getByText('50%', { exact: true }).waitFor({ state: 'visible' });
  await page.locator('label.lighttable-adjustment').filter({ hasText: 'Flow' })
    .getByText('30%', { exact: true }).waitFor({ state: 'visible' });

  await page.keyboard.press('F5');
  await page.getByRole('dialog', { name: 'Tool settings' }).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');

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
    beforeUndoDepth: before.history.undoDepth,
    afterUndoDepth: after.history.undoDepth,
    screenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Brush UX smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
