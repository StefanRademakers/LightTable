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

  await panel.getByRole('button', { name: 'New Action Set' }).click();
  const setDialog = window.getByRole('dialog', { name: 'New Action Set' });
  await setDialog.getByRole('textbox').fill('Smoke Set');
  await setDialog.getByRole('button', { name: 'OK' }).click();
  const smokeSet = panel.getByText('Smoke Set', { exact: true });
  await smokeSet.waitFor();
  const selectedSet = smokeSet.locator('..');
  if (!(await selectedSet.evaluate((element) => element.classList.contains('lighttable-panel-stack-row--active')))) {
    throw new Error('Clicking an Action Set did not make its row active.');
  }
  const emptySetEnabled = panel.getByRole('checkbox', { name: 'Enable Smoke Set' });
  if (!(await emptySetEnabled.isEnabled()) || !(await emptySetEnabled.isChecked())) {
    throw new Error('A new empty Action Set is not enabled by default.');
  }
  await emptySetEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Smoke Set'))?.querySelector('input');
    return input instanceof HTMLInputElement && !input.checked;
  });
  await emptySetEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Smoke Set'))?.querySelector('input');
    return input instanceof HTMLInputElement && input.checked;
  });

  for (const name of ['Empty one', 'Empty two']) {
    await panel.getByRole('button', { name: 'New Action', exact: true }).click();
    const emptyDialog = window.getByRole('dialog', { name: 'New Action' });
    await emptyDialog.getByRole('textbox').fill(name);
    await emptyDialog.getByRole('button', { name: 'OK' }).click();
    await window.waitForFunction(() =>
      window.__lightTableAutomation?.actionRecordingSnapshot?.().status === 'recording');
    await panel.getByText(name, { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Stop' }).click();
  }

  await panel.getByRole('button', { name: 'New Action', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'New Action' });
  await dialog.getByRole('textbox').fill('Layer setup');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await window.waitForFunction(() =>
    window.__lightTableAutomation?.actionRecordingSnapshot?.().status === 'recording');
  await Promise.all([
    panel.getByText('Empty one', { exact: true }).waitFor(),
    panel.getByText('Empty two', { exact: true }).waitFor()
  ]);

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
  const layerSetup = panel.getByText('Layer setup', { exact: true });
  await layerSetup.click();
  if (!(await layerSetup.locator('..').evaluate((element) =>
    element.classList.contains('lighttable-panel-stack-row--active')))) {
    throw new Error('Clicking an Action did not make its row active.');
  }
  const setEnabled = panel.getByRole('checkbox', { name: 'Enable Smoke Set' });
  await window.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Enable Smoke Set"]')
      ?? Array.from(document.querySelectorAll('label')).find((label) =>
        label.textContent?.includes('Enable Smoke Set'))?.querySelector('input');
    return input instanceof HTMLInputElement && !input.disabled;
  });
  await setEnabled.click();
  if (await setEnabled.isChecked()) throw new Error('Action Set enable control did not switch off.');
  await setEnabled.click();
  if (!(await setEnabled.isChecked())) throw new Error('Action Set enable control did not switch on.');
  const actionEnabled = panel.getByRole('checkbox', { name: 'Enable Layer setup' });
  await actionEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Layer setup'))?.querySelector('input');
    return input instanceof HTMLInputElement && !input.checked;
  });
  await actionEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Layer setup'))?.querySelector('input');
    return input instanceof HTMLInputElement && input.checked;
  });
  const emptyEnabled = panel.getByRole('checkbox', { name: 'Enable Empty one' });
  if (!(await emptyEnabled.isEnabled()) || !(await emptyEnabled.isChecked())) {
    throw new Error('A saved empty Action is not enabled by default.');
  }
  await emptyEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Empty one'))?.querySelector('input');
    return input instanceof HTMLInputElement && !input.checked;
  });
  await emptyEnabled.click();
  await window.waitForFunction(() => {
    const input = Array.from(document.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Enable Empty one'))?.querySelector('input');
    return input instanceof HTMLInputElement && input.checked;
  });

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

  await panel.getByRole('button', { name: 'New Action Set' }).click();
  const deleteSetDialog = window.getByRole('dialog', { name: 'New Action Set' });
  await deleteSetDialog.getByRole('textbox').fill('Delete me');
  await deleteSetDialog.getByRole('button', { name: 'OK' }).click();
  await panel.getByText('Delete me', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Delete selected' }).click();
  await panel.getByText('Delete me', { exact: true }).waitFor({ state: 'detached' });

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'History panel' }).click();
  const history = window.getByRole('complementary', { name: 'History' });
  await history.waitFor();
  if (await history.getByText(/Document Change|Edit document/i).count()) {
    throw new Error(`History still contains generic edit labels: ${await history.innerText()}`);
  }
  const historyGeometry = await window.evaluate(() => {
    const historyButton = document.querySelector('.lighttable-history-panel__footer button');
    const layerButton = document.querySelector('.lighttable-layers__footer button');
    const historyState = document.querySelector('.lighttable-history-panel__state');
    if (!(historyButton instanceof HTMLElement) || !(layerButton instanceof HTMLElement)
      || !(historyState instanceof HTMLElement)) return null;
    const historyBounds = historyButton.getBoundingClientRect();
    const layerBounds = layerButton.getBoundingClientRect();
    const stateStyle = getComputedStyle(historyState);
    const layerStyle = getComputedStyle(document.querySelector('.lighttable-layer'));
    return { historyButton: [historyBounds.width, historyBounds.height],
      layerButton: [layerBounds.width, layerBounds.height],
      stateRadius: stateStyle.borderRadius, layerRadius: layerStyle.borderRadius };
  });
  if (!historyGeometry
    || historyGeometry.historyButton.join('x') !== historyGeometry.layerButton.join('x')
    || historyGeometry.stateRadius !== historyGeometry.layerRadius) {
    throw new Error(`History drifts from the shared panel UI: ${JSON.stringify(historyGeometry)}`);
  }
  const historyOverflow = await window.evaluate(() => {
    const states = document.querySelector('.lighttable-history-panel__states');
    const label = document.querySelector('.lighttable-history-panel__state > span:last-child');
    if (!(states instanceof HTMLElement) || !(label instanceof HTMLElement)) return null;
    const original = label.textContent;
    label.textContent = 'A deliberately very long document name that must stay inside the History panel.psd';
    const style = getComputedStyle(label);
    const result = { clipped: label.scrollWidth > label.clientWidth,
      noHorizontalScroll: states.scrollWidth <= states.clientWidth,
      textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
    label.textContent = original;
    return result;
  });
  if (!historyOverflow?.clipped || !historyOverflow.noHorizontalScroll
    || historyOverflow.textOverflow !== 'ellipsis' || historyOverflow.whiteSpace !== 'nowrap') {
    throw new Error(`History labels do not ellipsize cleanly: ${JSON.stringify(historyOverflow)}`);
  }

  await window.screenshot({ path: path.join(output, 'actions-history-panels.png') });
  if (pageErrors.length) throw new Error(`Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop Actions and History panel smoke passed.');
} finally {
  await app?.close();
}
