import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'saved-actions-smoke');
await mkdir(output, { recursive: true });
const fixture = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons',
    'tool_shape_rectangle.png');
await access(fixture);
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const consoleErrors = [];

const openApp = async (label) => {
  const app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  window.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
  });
  const open = await waitForDesktopLauncher({ app, page: window, outputDirectory: output,
    sourceFile: fixture, pageErrors, label });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 }).catch(async (error) => {
      const evidence = await window.evaluate(() => ({
        title: document.title,
        body: document.body?.innerText.slice(0, 2_000),
        automation: Boolean(window.__lightTableAutomation),
        workspace: window.__lightTableAutomation?.queryWorkspace() ?? null
      })).catch(() => null);
      await window.screenshot({ path: path.join(output, `${label}-not-ready.png`) }).catch(() => undefined);
      throw new Error(`Desktop did not become ready: ${JSON.stringify({
        cause: error.message, pageErrors, consoleErrors, evidence
      })}`);
    });
  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  return { app, window, panel: window.getByRole('complementary', { name: 'Actions' }) };
};

let first; let second;
try {
  first = await openApp('saved-actions-record');
  const recorder = first.panel.locator('.lighttable-action-recorder');
  const setName = recorder.getByRole('textbox', { name: 'Action Set name' });
  await setName.fill('Portrait workflows');
  await recorder.getByRole('button', { name: 'New set' }).click();
  await recorder.getByRole('combobox', { name: 'Action Set' })
    .getByRole('option', { name: 'Portrait workflows' }).waitFor({ state: 'attached' });
  await setName.fill('Portrait recipes');
  await recorder.getByRole('button', { name: 'Rename', exact: true }).click();
  await recorder.getByRole('combobox', { name: 'Action Set' })
    .getByRole('option', { name: 'Portrait recipes' }).waitFor({ state: 'attached' });
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
  const renameStep = recorder.locator('li').filter({ hasText: 'layer.rename' });
  await renameStep.locator('summary').click();
  const stepEditor = renameStep.locator('.lighttable-action-step-editor');
  await stepEditor.getByRole('textbox', { name: 'Name', exact: true }).fill('Schema edited layer');
  await stepEditor.getByRole('button', { name: 'Apply parameters' }).click();
  await stepEditor.getByRole('status').filter({ hasText: 'Parameters updated.' }).waitFor();
  await renameStep.getByRole('combobox', { name: 'Step 2 parameter' }).selectOption({ label: 'name' });
  await renameStep.getByRole('textbox', { name: 'Step 2 new variable name' }).fill('layerName');
  await renameStep.getByRole('button', { name: 'Promote' }).click();
  await recorder.getByRole('textbox', { name: 'layerName default' }).waitFor();
  await recorder.getByRole('textbox', { name: 'Action name' }).fill('Persistent layer setup');
  await recorder.getByRole('button', { name: 'Save', exact: true }).click();
  await recorder.getByRole('combobox', { name: 'Saved Actions' })
    .getByRole('option', { name: /Persistent layer setup \(2\)/ })
    .waitFor({ state: 'attached' });
  await setName.fill('Product workflows');
  await recorder.getByRole('button', { name: 'New set' }).click();
  await recorder.getByRole('textbox', { name: 'Action name' }).fill('Product layer setup');
  await recorder.getByRole('button', { name: 'Save', exact: true }).click();
  const setSelect = recorder.getByRole('combobox', { name: 'Action Set' });
  const savedSelect = recorder.getByRole('combobox', { name: 'Saved Actions' });
  await savedSelect.getByRole('option', { name: /Product layer setup \(2\)/ })
    .waitFor({ state: 'attached' });
  if (await savedSelect.getByRole('option', { name: /Persistent layer setup/ }).count() !== 0) {
    throw new Error('The Product set exposed an Action from the Portrait set.');
  }
  await setSelect.selectOption({ label: 'Portrait recipes' });
  await savedSelect.getByRole('option', { name: /Persistent layer setup \(2\)/ })
    .waitFor({ state: 'attached' });
  if (await savedSelect.getByRole('option', { name: /Product layer setup/ }).count() !== 0) {
    throw new Error('The Portrait set exposed an Action from the Product set.');
  }
  await setSelect.selectOption({ label: 'Product workflows' });
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
  const restoredSets = restored.getByRole('combobox', { name: 'Action Set' });
  const saved = restored.getByRole('combobox', { name: 'Saved Actions' });
  await saved.getByRole('option', { name: /Product layer setup \(2\)/ })
    .waitFor({ state: 'attached', timeout: 10_000 }).catch(async () => {
      const panelEvidence = await second.window.evaluate(() => ({
        origin: location.origin,
        panel: document.querySelector('.lighttable-action-recorder')?.textContent
      }));
      const stored = await readFile(path.join(userData, 'actions-v1.json'), 'utf8').catch(() => null);
      throw new Error(`Saved Action did not survive restart: ${JSON.stringify({ panelEvidence, stored })}`);
    });
  if (await restoredSets.inputValue() === ''
    || await restoredSets.locator('option:checked').textContent() !== 'Product workflows') {
    throw new Error('The selected Action Set did not survive restart.');
  }
  if (await saved.getByRole('option', { name: /Persistent layer setup/ }).count() !== 0) {
    throw new Error('Restart exposed an Action from a non-selected set.');
  }
  const storedEnvelope = JSON.parse(await readFile(path.join(userData, 'actions-v1.json'), 'utf8'));
  if (storedEnvelope?.version !== 4 || storedEnvelope.sets?.length !== 3
    || storedEnvelope.actions?.length !== 2
    || new Set(storedEnvelope.actions.map((action) => action.setId)).size !== 2
    || storedEnvelope.actions.some((action) => action.recording?.variables?.[0]?.name !== 'layerName'
      || action.recording?.variables?.[0]?.defaultValue !== 'Schema edited layer'
      || action.recording?.steps?.[1]?.parameters?.layerId?.$lighttableResult?.step !== 1)) {
    throw new Error(`Action Set envelope is incomplete: ${JSON.stringify(storedEnvelope)}`);
  }
  await restoredSets.selectOption({ label: 'Portrait recipes' });
  await saved.getByRole('option', { name: /Persistent layer setup \(2\)/ })
    .waitFor({ state: 'attached' });
  await restored.getByRole('button', { name: 'Load' }).click();
  await restored.locator('li').filter({ hasText: 'layer.createRaster' }).waitFor();
  await restored.locator('li').filter({ hasText: 'layer.rename' }).waitFor();
  const restoredVariable = restored.getByRole('textbox', { name: 'layerName default' });
  await restoredVariable.fill('Replayed variable layer');
  await restoredVariable.blur();
  const replayBefore = await second.window.locator('.lighttable-layer[data-layer-id]').count();
  await restored.getByRole('button', { name: 'Play', exact: true }).click();
  await second.window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count + 1,
  replayBefore, { timeout: 30_000 });
  await restored.getByRole('status').filter({ hasText: 'Playback: completed' }).waitFor();
  await second.window.getByRole('treeitem', { name: /Replayed variable layer.*raster layer/i }).waitFor();
  if (await restored.locator('li').count() !== 2) {
    throw new Error('Playback recursively changed the saved two-step Action.');
  }
  await restoredSets.selectOption({ label: 'Product workflows' });
  await restored.getByRole('button', { name: 'Delete set' }).click();
  await restoredSets.getByRole('option', { name: 'Product workflows' })
    .waitFor({ state: 'detached' });
  const afterDelete = JSON.parse(await readFile(path.join(userData, 'actions-v1.json'), 'utf8'));
  if (afterDelete.sets?.length !== 2 || afterDelete.actions?.length !== 1
    || afterDelete.actions[0]?.name !== 'Persistent layer setup') {
    throw new Error(`Deleting a set did not delete only its contained Actions: ${JSON.stringify(afterDelete)}`);
  }
  if (pageErrors.length) throw new Error(`Saved Actions page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop saved Actions restart smoke passed.');
} finally {
  await first?.app.close().catch(() => undefined);
  await second?.app.close().catch(() => undefined);
}
