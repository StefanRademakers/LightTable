import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'apps', 'desktop');
const executable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'tmp', 'smoke-onboarding-user-data');
const saveTarget = path.join(root, 'tmp', 'onboarding-export.bin');
const screenshotDirectory = path.join(root, 'tmp', 'screenshots', 'onboarding');
await Promise.all([
  rm(userData, { recursive: true, force: true }),
  rm(saveTarget, { force: true }),
  mkdir(userData, { recursive: true }),
  mkdir(screenshotDirectory, { recursive: true })
]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: executable,
    args: [desktop], cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_SAVE_FILE: saveTarget
    }, timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => errors.push(error.message));
  await window.setViewportSize({ width: 1024, height: 768 });
  const startGuide = window.getByRole('button', { name: 'Try a guided layered edit' });
  await startGuide.waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    await window.screenshot({ path: path.join(screenshotDirectory, 'launcher-failure.png') });
    throw new Error(`Guided action did not appear. Body: ${(await window.locator('body').innerText()).slice(0, 1000)}`);
  });
  await window.context().setOffline(true);
  await startGuide.focus();
  await window.keyboard.press('Enter');
  await window.getByRole('tab', { name: /LightTable guided sample/i }).waitFor({ state: 'visible', timeout: 30_000 });
  const guide = window.getByRole('complementary', { name: 'Guided sample' });
  await guide.getByRole('button', { name: 'Create an editable shape' }).waitFor({ state: 'visible', timeout: 30_000 });
  await window.screenshot({ path: path.join(screenshotDirectory, '1024x768-guide.png') });

  await guide.getByRole('button', { name: 'Create an editable shape' }).click();
  await window.waitForFunction(() => document.querySelector('.lighttable-guide__error')
    || [...document.querySelectorAll('.lighttable-guide button')].some((button) => button.textContent?.includes('Undo the edit')),
  undefined, { timeout: 30_000 });
  const shapeError = await guide.locator('.lighttable-guide__error').textContent().catch(() => null);
  if (shapeError) throw new Error(`Guided shape failed: ${shapeError}`);
  await guide.getByRole('button', { name: 'Undo the edit' }).waitFor();
  await window.getByRole('treeitem', { name: /Guided sample shape/i }).waitFor();
  await guide.getByRole('button', { name: 'Undo the edit' }).click();
  await guide.getByRole('button', { name: 'Redo the edit' }).waitFor();
  if (await window.getByRole('treeitem', { name: /Guided sample shape/i }).count() !== 0) {
    throw new Error('Guided undo left the vector layer in the layer tree.');
  }
  await guide.getByRole('button', { name: 'Redo the edit' }).click();
  await guide.getByRole('button', { name: 'Quick export PNG' }).waitFor();
  await window.getByRole('treeitem', { name: /Guided sample shape/i }).waitFor();

  await guide.getByRole('button', { name: 'Quick export PNG' }).click();
  await window.waitForFunction(() => document.querySelector('.lighttable-guide__error')
    || [...document.querySelectorAll('.lighttable-guide button')].some((button) => button.textContent?.includes('Export Photoshop PSD')),
  undefined, { timeout: 30_000 });
  const pngError = await guide.locator('.lighttable-guide__error').textContent().catch(() => null);
  if (pngError) throw new Error(`Guided PNG export failed: ${pngError}`);
  await guide.getByRole('button', { name: 'Export Photoshop PSD' }).waitFor({ timeout: 30_000 });
  if ((await readFile(saveTarget)).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Guided PNG export did not produce a PNG artifact.');
  }
  await guide.getByRole('button', { name: 'Export Photoshop PSD' }).click();
  await guide.getByRole('button', { name: 'Finish' }).waitFor({ timeout: 30_000 });
  if ((await readFile(saveTarget)).subarray(0, 4).toString('ascii') !== '8BPS') {
    throw new Error('Guided PSD export did not produce a PSD artifact.');
  }
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.screenshot({ path: path.join(screenshotDirectory, '1440x900-complete.png') });
  await guide.getByRole('button', { name: 'Finish' }).click();
  await guide.waitFor({ state: 'detached' });

  await window.getByRole('menuitem', { name: 'Help' }).click();
  await window.getByRole('menuitem', { name: /Commands and Shortcuts/i }).click();
  const help = window.getByRole('dialog', { name: 'Commands and shortcuts' });
  await help.getByRole('searchbox', { name: 'Search commands' }).fill('Ctrl+O');
  await help.locator('.lighttable-command-help__row').filter({ hasText: 'Open' }).filter({ hasText: 'Ctrl+O' }).waitFor();
  await window.keyboard.press('Escape');
  await help.waitFor({ state: 'detached' });
  if (errors.length) throw new Error(`Onboarding page errors: ${errors.join('; ')}`);
  process.stdout.write(`Desktop onboarding smoke passed offline: ${screenshotDirectory}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
