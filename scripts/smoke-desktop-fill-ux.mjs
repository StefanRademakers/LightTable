import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'fill-ux-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'fill-dialog.png');
const reportPath = path.join(outputDirectory, 'fill-ux.json');

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
  const driver = await attachLightTableAutomation(page, 'fill-ux-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  await driver.execute(documentId, 'layer.createRaster', {});

  await page.keyboard.press('g');
  await page.getByRole('button', { name: 'Fill (G)', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('d');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');

  await page.keyboard.press('Shift+F5');
  await page.getByRole('combobox', { name: 'Fill contents' }).selectOption('background');
  await page.getByRole('checkbox', { name: 'Preserve transparency' }).check();
  await page.screenshot({ path: screenshotPath });
  await page.getByRole('button', { name: 'Fill', exact: true }).last().click();
  const afterDialog = await driver.queryDocument(documentId);
  if (!afterDialog || afterDialog.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error('The Fill dialog did not commit exactly one command.');
  }

  await page.keyboard.press('Control+z');
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  await page.keyboard.down('Alt');
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.classList.contains('lighttable-viewport--eyedropper'));
  await viewport.evaluate((element) => {
    if (!element.classList.contains('lighttable-viewport--eyedropper')) {
      throw new Error('Alt did not activate the temporary Fill eyedropper.');
    }
  });
  await page.mouse.click(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.20);
  await page.keyboard.up('Alt');

  const beforeClick = await driver.queryDocument(documentId);
  await page.keyboard.down('Shift');
  await page.mouse.click(bounds.x + bounds.width * 0.16, bounds.y + bounds.height * 0.22);
  await page.keyboard.up('Shift');
  const afterClick = await driver.queryDocument(documentId);
  if (!beforeClick || !afterClick
    || afterClick.history.undoDepth !== beforeClick.history.undoDepth + 1) {
    throw new Error('Shift-click Fill did not commit a transparency-preserving command.');
  }
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    dialogCommit: afterDialog.history.undoDepth,
    clickCommit: afterClick.history.undoDepth,
    screenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Fill UX smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
