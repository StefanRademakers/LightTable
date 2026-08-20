import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const evidenceDirectory = path.join(root, 'tmp', 'actions-panel-smoke');
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([access(fixture), mkdir(evidenceDirectory, { recursive: true })]);
const userData = await mkdtemp(path.join(evidenceDirectory, 'profile-'));
const screenshot = path.join(evidenceDirectory, 'actions-panel.png');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
const pageErrors = [];
try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory: evidenceDirectory,
    sourceFile: fixture, pageErrors, label: 'actions-panel'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  await panel.getByRole('radio', { name: 'Actions' }).waitFor();
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await recorder.getByText('recording', { exact: true }).waitFor();

  const viewport = window.locator('.lighttable-viewport');
  const viewportBounds = await viewport.boundingBox();
  if (!viewportBounds) throw new Error('Actions smoke could not measure the canvas viewport.');
  await window.keyboard.press('m');
  await window.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Rectangular selection' }).waitFor();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.3,
    viewportBounds.y + viewportBounds.height * 0.3
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.55,
    viewportBounds.y + viewportBounds.height * 0.55,
    { steps: 12 }
  );
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'selection.applyShape' }).waitFor();

  const layerRows = window.getByRole('treeitem');
  const before = await layerRows.count();
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before + 1
  );
  await recorder.locator('li').filter({ hasText: 'layer.createRaster' }).waitFor();
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Rename Layer' }).click();
  const focusedLayerName = window.locator('input[aria-label="Layer name"]:focus');
  await focusedLayerName.fill('Recorded Title');
  await focusedLayerName.press('Enter');
  await recorder.locator('li').filter({ hasText: 'layer.rename' }).waitFor();

  await panel.getByRole('radio', { name: 'Commands' }).click();
  await panel.getByText(/commands$/).waitFor();
  const undo = panel.locator('details').filter({ hasText: 'history.undo' });
  await undo.locator('summary').click();
  const undoButton = undo.getByRole('button', { name: 'Run' });
  await undoButton.waitFor();
  await undoButton.click();
  await panel.getByRole('status').filter({ hasText: 'history.undo: completed' })
    .waitFor({ timeout: 15_000 });
  await undoButton.click();
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before
  );
  await panel.getByRole('radio', { name: 'Actions' }).click();
  const undoSteps = recorder.locator('li').filter({ hasText: 'history.undo' });
  await undoSteps.first().waitFor();
  if (await undoSteps.count() !== 2) throw new Error('Expected two recorded Undo diagnostics.');
  const undoStep = undoSteps.first();
  await undoStep.locator('summary').click();
  await undoStep.getByText('Replayable').waitFor();
  await undoStep.getByText('no', { exact: true }).waitFor();
  const renameStep = recorder.locator('li').filter({ hasText: 'layer.rename' });
  await renameStep.locator('summary').click();
  await renameStep.getByText('$step2.layerId', { exact: false }).waitFor();
  await recorder.getByRole('button', { name: 'Stop' }).click();
  await recorder.getByText('stopped', { exact: true }).waitFor();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 15_000 });
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before + 1
  );
  await window.waitForFunction(
    (expected) => [...document.querySelectorAll('input[aria-label="Layer name"]')]
      .some((input) => input.value === expected),
    'Recorded Title',
    { timeout: 15_000 }
  );

  await window.screenshot({ path: screenshot });
  if (pageErrors.length) throw new Error(`Actions panel page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Desktop Actions panel smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
