import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'line-tool-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'line-tool.png');
const reportPath = path.join(outputDirectory, 'line-tool.json');

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
  const nativeMenuPresent = await app.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null);
  if (nativeMenuPresent) throw new Error('The native Electron application menu is still installed.');
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'line-tool-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');

  // U enters the shape family; Shift+U walks backward from Rectangle to Line.
  await page.keyboard.press('u');
  await page.keyboard.press('Shift+u');
  await page.keyboard.press('d');
  await page.getByText('Line', { exact: true }).first().waitFor({ state: 'visible' });

  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  const start = { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height * 0.30 };
  const firstEnd = { x: start.x + 180, y: start.y + 70 };

  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(firstEnd.x, firstEnd.y, { steps: 4 });
  await page.keyboard.down('Space');
  await page.mouse.move(firstEnd.x + 45, firstEnd.y + 25, { steps: 3 });
  await page.keyboard.up('Space');
  await page.screenshot({ path: screenshotPath });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');

  const after = await driver.queryDocument(documentId);
  if (!after
    || after.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error('The line gesture did not commit exactly one document command.');
  }
  const layers = await driver.queryLayers(documentId) ?? [];
  const layer = layers.find(({ id }) => id === after.activeLayerId);
  if (layer?.type !== 'vector') {
    throw new Error('The line gesture did not leave an editable vector layer active.');
  }

  await page.keyboard.press('a');
  await page.getByRole('button', { name: 'Path selection' }).waitFor({ state: 'visible' });
  const afterPathSelection = await driver.queryDocument(documentId);
  await page.keyboard.press('v');
  await page.getByRole('button', { name: 'Move' }).waitFor({ state: 'visible' });
  const afterMove = await driver.queryDocument(documentId);
  if (afterMove?.lifecycle !== 'ready') {
    await page.getByText('Debug', { exact: true }).last().click();
    throw new Error(`Move activation failed the document: ${await page.locator('body').innerText()}`);
  }
  await page.keyboard.press('Control+z');
  const undone = await driver.queryDocument(documentId);
  if (!undone
    || undone.layerCount !== before.layerCount
    || undone.history.undoDepth !== before.history.undoDepth) {
    const runtimeText = await page.locator('body').innerText();
    throw new Error(`Ctrl+Z did not undo the line command: ${JSON.stringify({ before, afterPathSelection, afterMove, undone, pageErrors, consoleErrors, runtimeText })}`);
  }
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    beforeLayerCount: before.layerCount,
    createdLayerId: layer.id,
    pageErrors,
    screenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Line Tool UX smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
