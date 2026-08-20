import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'saved-actions-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];

const openApp = async (label) => {
  const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  return { app, window, panel: window.getByRole('complementary', { name: 'Actions' }) };
};

let first; let second;
try {
  first = await openApp('saved-actions-record');
  const recorder = first.panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  const before = await first.window.locator('.lighttable-layer[data-layer-id]').count();
  await first.window.getByRole('menuitem', { name: 'Layer' }).click();
  await first.window.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  await recorder.locator('li').filter({ hasText: 'layer.createRaster' }).waitFor();
  await first.window.getByRole('menuitem', { name: 'Layer' }).click();
  await first.window.getByRole('menuitem', { name: 'Rename Layer' }).click();
  const nameInput = first.window.locator('input[aria-label="Layer name"]:focus');
  await nameInput.fill('Persistent Action Layer');
  await nameInput.press('Enter');
  await recorder.locator('li').filter({ hasText: 'layer.rename' }).waitFor();
  await recorder.getByRole('button', { name: 'Stop' }).click();
  await recorder.getByRole('textbox', { name: 'Action name' }).fill('Persistent layer setup');
  await recorder.getByRole('button', { name: 'Save', exact: true }).click();
  await recorder.getByRole('combobox', { name: 'Saved Actions' })
    .getByRole('option', { name: /Persistent layer setup \(2\)/ })
    .waitFor({ state: 'attached' });
  if (await first.window.locator('.lighttable-layer[data-layer-id]').count() !== before + 1) {
    throw new Error('Recording did not create exactly one layer.');
  }
  await first.window.keyboard.press('Control+z');
  await first.window.keyboard.press('Control+z');
  await first.window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count, before);
  const closed = first.app.waitForEvent('close');
  await first.window.evaluate(() => window.lightTableDesktop.closeApplication());
  await closed;
  first = null;

  second = await openApp('saved-actions-restart');
  const restored = second.panel.locator('.lighttable-action-recorder');
  const saved = restored.getByRole('combobox', { name: 'Saved Actions' });
  await saved.getByRole('option', { name: /Persistent layer setup \(2\)/ })
    .waitFor({ state: 'attached', timeout: 10_000 }).catch(async () => {
      const evidence = await second.window.evaluate(() => ({
        origin: location.origin,
        keys: Object.keys(localStorage),
        actions: localStorage.getItem('lighttable.actions.v1'),
        panel: document.querySelector('.lighttable-action-recorder')?.textContent
      }));
      throw new Error(`Saved Action did not survive restart: ${JSON.stringify(evidence)}`);
    });
  await restored.getByRole('button', { name: 'Load' }).click();
  await restored.locator('li').filter({ hasText: 'layer.createRaster' }).waitFor();
  await restored.locator('li').filter({ hasText: 'layer.rename' }).waitFor();
  const replayBefore = await second.window.locator('.lighttable-layer[data-layer-id]').count();
  await restored.getByRole('button', { name: 'Play', exact: true }).click();
  await second.window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count + 1,
  replayBefore, { timeout: 30_000 });
  await restored.getByRole('status').filter({ hasText: 'Playback: completed' }).waitFor();
  await second.window.getByRole('treeitem', { name: /Persistent Action Layer.*raster layer/i }).waitFor();
  if (await restored.locator('li').count() !== 2) {
    throw new Error('Playback recursively changed the saved two-step Action.');
  }
  if (pageErrors.length) throw new Error(`Saved Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop saved Actions restart smoke passed.');
} finally {
  await first?.app.close().catch(() => undefined);
  await second?.app.close().catch(() => undefined);
}
