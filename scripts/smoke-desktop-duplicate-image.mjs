import { _electron as electron } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'duplicate-image-smoke');
const userData = path.join(output, 'user-data');
const reportPath = path.join(output, 'report.json');
const source = process.env.LIGHTTABLE_DUPLICATE_SMOKE_SOURCE
  ?? path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png');
const expectedDefaultName = `${path.basename(source).replace(/\.[^.]+$/, '')} copy`;
await rm(output, { recursive: true, force: true });
await mkdir(userData, { recursive: true });
const launch = await resolveDesktopTestLaunch(root);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: source },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const activeEditor = () => page.locator('.lighttable-backdrop:not(.lighttable-backdrop--inactive)');
  const sourceTabName = new RegExp(path.basename(source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const sourceTab = page.getByRole('tab', { name: sourceTabName });
  await Promise.race([
    sourceTab.waitFor({ timeout: 10_000 }).catch(() => undefined),
    page.getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 10_000 }).catch(() => undefined)
  ]);
  if (!await sourceTab.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Open', exact: true }).click();
  }
  await activeEditor().locator('.lighttable-document-tab').waitFor({ timeout: 30_000 });

  await activeEditor().locator('.shots-app-menu__button').filter({ hasText: /^Image$/ }).click();
  await page.getByRole('menuitem', { name: 'Duplicate...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate Image' });
  await dialog.waitFor();
  const name = dialog.getByLabel('As');
  await page.waitForFunction((expected) => document.querySelector('[role="dialog"][aria-label="Duplicate Image"] input')?.value === expected, expectedDefaultName);
  const selection = await name.evaluate((input) => ({
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd
  }));
  if (selection.value !== expectedDefaultName || selection.start !== 0 || selection.end !== selection.value.length) {
    throw new Error(`Duplicate default name was not selected: ${JSON.stringify(selection)}`);
  }
  await name.fill('Independent duplicate');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 }).catch(async (reason) => {
    throw new Error(`${reason.message}\nDialog: ${await dialog.innerText()}\nErrors: ${JSON.stringify(errors)}`);
  });
  const visibleTabs = page.locator('.lighttable-document-tabs:visible .lighttable-document-tab');
  for (let attempt = 0; attempt < 60 && await visibleTabs.count() !== 2; attempt += 1) {
    await page.waitForTimeout(100);
  }
  if (await visibleTabs.count() !== 2) throw new Error('The duplicate tab was not published atomically.');
  const activeTitle = await activeEditor().locator('.lighttable-document-tab--active').textContent();
  if (!activeTitle?.includes('Independent duplicate')) throw new Error(`Duplicate was not activated: ${activeTitle}`);

  await activeEditor().locator('.shots-app-menu__button').filter({ hasText: /^Layer$/ }).click();
  await page.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  await activeEditor().getByRole('tab', { name: sourceTabName }).click();
  const sourceLayers = await activeEditor().locator('.lighttable-layer').count();
  await activeEditor().getByRole('tab', { name: /Independent duplicate/i }).click();
  const duplicateLayers = await activeEditor().locator('.lighttable-layer').count();
  if (duplicateLayers <= sourceLayers) throw new Error('Editing the duplicate did not remain independent from the source.');
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);

  await page.screenshot({ path: path.join(output, 'duplicate-image.png') });
  await writeFile(reportPath, `${JSON.stringify({ sourceLayers, duplicateLayers, activeTitle, errors }, null, 2)}\n`);
  process.stdout.write(`Desktop Duplicate Image smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
