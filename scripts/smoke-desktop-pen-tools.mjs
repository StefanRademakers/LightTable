import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'pen-tools-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'pen-tools.png');
const rubberBandScreenshotPath = path.join(outputDirectory, 'pen-rubber-band.png');
const reportPath = path.join(outputDirectory, 'pen-tools.json');

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
  const driver = await attachLightTableAutomation(page, 'pen-tools-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);

  await page.keyboard.press('p');
  const group = page.locator('.lighttable-toolbox__group').filter({
    has: page.getByRole('button', { name: 'Show pen tools' })
  });
  const master = group.locator(':scope > .lighttable-toolbox__button');
  await master.waitFor({ state: 'visible' });
  if (await master.getAttribute('aria-pressed') !== 'true') {
    throw new Error('P did not activate the Pen tool.');
  }

  await master.click();
  const family = page.getByRole('toolbar', { name: 'Pen tools' });
  await family.waitFor({ state: 'visible' });
  for (const name of ['Pen (P)', 'Add anchor point', 'Delete anchor point', 'Convert anchor point']) {
    await family.getByRole('button', { name }).waitFor({ state: 'visible' });
  }

  await family.getByRole('button', { name: 'Add anchor point' }).click();
  const rememberedMaster = group.locator(':scope > .lighttable-toolbox__button');
  await rememberedMaster.waitFor({ state: 'visible' });
  if (await rememberedMaster.getAttribute('aria-label') !== 'Add anchor point') {
    throw new Error('The selected anchor tool was not shown in the grouped slot.');
  }
  if (await rememberedMaster.getAttribute('aria-pressed') !== 'true') {
    throw new Error('The selected anchor tool was not projected into the grouped slot.');
  }

  await rememberedMaster.click();
  await family.waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });
  await page.keyboard.press('Shift+p');
  if (await master.getAttribute('aria-label') !== 'Pen (P)') {
    throw new Error('Shift+P did not cycle back to the Pen tool.');
  }
  const penSettings = page.getByLabel('Pen settings');
  await penSettings.waitFor({ state: 'visible' });
  for (const label of ['Auto Add/Delete', 'Rubber Band']) {
    const control = penSettings.getByText(label, { exact: true });
    await control.waitFor({ state: 'visible' });
  }
  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds || !before) throw new Error('Pen authoring viewport is unavailable.');
  const first = { x: bounds.x + bounds.width * 0.62, y: bounds.y + bounds.height * 0.66 };
  const second = { x: bounds.x + bounds.width * 0.72, y: bounds.y + bounds.height * 0.77 };
  const third = { x: bounds.x + bounds.width * 0.82, y: bounds.y + bounds.height * 0.64 };
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.screenshot({ path: rubberBandScreenshotPath });
  await page.mouse.move(second.x, second.y);
  await page.mouse.down();
  await page.mouse.move(second.x + 28, second.y - 24, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(third.x, third.y);
  await page.keyboard.press('Enter');
  const after = await driver.queryDocument(documentId);
  if (!after || ![before.layerCount, before.layerCount + 1].includes(after.layerCount)
    || after.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Pen authoring did not commit exactly once: ${JSON.stringify({ before, after })}`);
  }

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({ sourceFile, before, after, pageErrors, screenshotPath, rubberBandScreenshotPath }, null, 2)}\n`);
  process.stdout.write(`Pen-tools smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
