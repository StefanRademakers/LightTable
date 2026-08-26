import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2]
  ?? path.join(root, '..', 'LightTableTestFiles', 'RandomFiles', 'shapes.psd'));
const output = path.join(root, 'tmp', 'async-actions-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });

let app;
const pageErrors = [];
try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label: 'async-actions' });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(window, 'async-actions');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('Async Actions smoke has no active document.');

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  await panel.getByRole('button', { name: 'New Action', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'New Action' });
  await dialog.getByRole('textbox').fill('Native export');
  await dialog.getByRole('button', { name: 'OK' }).click();

  const artifactsBefore = await window.evaluate(() =>
    window.__lightTableAutomation?.listArtifacts().length ?? -1);
  const accepted = await driver.execute(documentId, 'file.exportNative', {}, { requireCompleted: false });
  if (accepted.status !== 'accepted') throw new Error(`Export was not asynchronous: ${JSON.stringify(accepted)}`);
  await driver.waitForTask(documentId, accepted.taskId);
  await window.waitForFunction(() => {
    const step = window.__lightTableAutomation?.actionRecordingSnapshot?.().steps[0];
    return step?.outcome === 'accepted' && Boolean(step.result?.artifact?.id);
  }, undefined, { timeout: 30_000 });
  await panel.getByRole('button', { name: 'Stop' }).click();
  await panel.locator('[data-command="file.exportNative"]').waitFor();

  await panel.getByRole('button', { name: 'Play', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 60_000 });
  const artifactsAfter = await window.evaluate(() =>
    window.__lightTableAutomation?.listArtifacts().length ?? -1);
  if (artifactsAfter !== artifactsBefore + 2) {
    throw new Error(`Async Action did not publish once per run: ${artifactsBefore} -> ${artifactsAfter}`);
  }
  if ((await driver.queryActionRecording())?.steps.length !== 1) {
    throw new Error('Action playback recursively changed the recording.');
  }
  if (pageErrors.length) throw new Error(`Async Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop task-aware Actions smoke passed.');
} finally {
  await app?.close();
}
