import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2]
  ?? path.join(root, '..', 'LightTableTestFiles', 'RandomFiles', 'shapes.psd'));
const output = path.join(root, 'tmp', 'actions-panel-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
const pageErrors = [];
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label: 'actions-panel' });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(window, 'actions-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('Actions smoke has no active document.');

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  await panel.waitFor();
  await panel.getByRole('button', { name: 'New Action', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'New Action' });
  await dialog.getByRole('textbox').fill('Layer setup');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await window.waitForFunction(() =>
    window.__lightTableAutomation?.actionRecordingSnapshot?.().status === 'recording');

  const created = await driver.execute(documentId, 'layer.createRaster');
  const layerId = created.value?.layerId;
  if (typeof layerId !== 'string') throw new Error('New Pixel Layer returned no layer ID.');
  await driver.execute(documentId, 'layer.rename', { layerId, name: 'Action layer' });
  await panel.getByRole('button', { name: 'Stop' }).click();

  const createStep = panel.locator('[data-command="layer.createRaster"]');
  const renameStep = panel.locator('[data-command="layer.rename"]');
  await Promise.all([createStep.waitFor(), renameStep.waitFor()]);
  if (await panel.getByText('Layer setup', { exact: true }).count() !== 1) {
    throw new Error('The saved Action was not projected once in the tree.');
  }

  const geometry = await window.evaluate(() => {
    const action = document.querySelector('.lighttable-action-tree__row');
    const layer = document.querySelector('.lighttable-layer');
    const layerName = document.querySelector('.lighttable-layer__name');
    if (!(action instanceof HTMLElement) || !(layer instanceof HTMLElement)
      || !(layerName instanceof HTMLElement)) return null;
    const a = getComputedStyle(action); const l = getComputedStyle(layer);
    const name = getComputedStyle(layerName);
    return { actionHeight: action.getBoundingClientRect().height,
      layerHeight: layer.getBoundingClientRect().height,
      actionFont: a.fontSize, layerFont: name.fontSize,
      actionRadius: a.borderRadius, layerRadius: l.borderRadius };
  });
  if (!geometry || Math.abs(geometry.actionHeight - geometry.layerHeight) > 0.5
    || geometry.actionFont !== geometry.layerFont || geometry.actionRadius !== geometry.layerRadius) {
    throw new Error(`Actions rows drift from the Layers UI geometry: ${JSON.stringify(geometry)}`);
  }
  await window.screenshot({ path: path.join(output, 'actions-panel.png') });

  const layersBeforePlay = (await driver.queryLayers(documentId))?.length ?? 0;
  await panel.getByRole('button', { name: 'Play', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 30_000 });
  const layersAfterPlay = (await driver.queryLayers(documentId))?.length ?? 0;
  if (layersAfterPlay !== layersBeforePlay + 1) {
    throw new Error(`Action playback created ${layersAfterPlay - layersBeforePlay} layers instead of one.`);
  }

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'History panel' }).click();
  const history = window.getByRole('complementary', { name: 'History' });
  await history.waitFor();
  if (await history.getByText(/Document Change|Edit document/i).count()) {
    throw new Error(`History still contains generic edit labels: ${await history.innerText()}`);
  }

  await window.screenshot({ path: path.join(output, 'actions-history-panels.png') });
  if (pageErrors.length) throw new Error(`Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop Actions and History panel smoke passed.');
} finally {
  await app?.close();
}
