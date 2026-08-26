import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2]
  ?? path.join(root, '..', 'LightTableTestFiles', 'RandomFiles', 'shapes.psd'));
const output = path.join(root, 'tmp', 'saved-actions-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });

const start = async (label) => {
  const pageErrors = [];
  const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const panel = window.getByRole('complementary', { name: 'Actions' });
  if (!await panel.isVisible().catch(() => false)) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await panel.waitFor();
  return { app, window, pageErrors,
    panel,
    driver: await attachLightTableAutomation(window, label) };
};

let running;
try {
  running = await start('saved-actions-create');
  const documentId = (await running.driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('Saved Actions smoke has no active document.');
  await running.panel.getByRole('button', { name: 'New Action', exact: true }).click();
  const dialog = running.window.getByRole('dialog', { name: 'New Action' });
  await dialog.getByRole('textbox').fill('Persisted layer');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await running.driver.execute(documentId, 'layer.createRaster');
  await running.panel.getByRole('button', { name: 'Stop' }).click();
  await running.panel.getByText('Persisted layer', { exact: true }).waitFor({ timeout: 10_000 })
    .catch(async () => {
      throw new Error(`Restored Actions were not projected: ${JSON.stringify({
        panel: await running.panel.innerText(),
        recording: await running.driver.queryActionRecording(),
        body: (await running.window.locator('body').innerText()).slice(-1800)
      })}`);
    });
  if (running.pageErrors.length) throw new Error(running.pageErrors.join(' | '));
  await running.app.close();
  running = null;

  const envelope = JSON.parse(await readFile(path.join(userData, 'actions.json'), 'utf8'));
  if (envelope.version !== undefined || envelope.format !== 'lighttable-actions'
    || envelope.actions?.[0]?.name !== 'Persisted layer') {
    throw new Error(`Saved Action uses the wrong alpha envelope: ${JSON.stringify(envelope)}`);
  }

  running = await start('saved-actions-restore');
  await running.panel.getByText('Persisted layer', { exact: true }).waitFor({ timeout: 10_000 })
    .catch(async () => {
      throw new Error(`Restored Actions were not projected: ${JSON.stringify({
        panel: await running.panel.innerText(),
        recording: await running.driver.queryActionRecording(),
        body: (await running.window.locator('body').innerText()).slice(-1800)
      })}`);
    });
  await running.panel.getByText('Persisted layer', { exact: true }).click();
  await running.panel.getByRole('button', { name: 'Delete selected' }).click();
  await running.panel.getByText('Persisted layer', { exact: true }).waitFor({ state: 'detached' });
  if (running.pageErrors.length) throw new Error(running.pageErrors.join(' | '));
  const afterDelete = JSON.parse(await readFile(path.join(userData, 'actions.json'), 'utf8'));
  if (afterDelete.actions.length !== 0) throw new Error('Deleted Action remained in durable storage.');
  console.log('Desktop saved Actions smoke passed.');
} finally {
  await running?.app.close();
}
