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
  await panel.getByText(/commands$/).waitFor();

  const layerRows = window.getByRole('treeitem');
  const before = await layerRows.count();
  const create = panel.locator('details').filter({ hasText: 'layer.createRaster' });
  await create.locator('summary').click();
  await create.getByRole('button', { name: 'Run' }).click();
  await panel.getByRole('status').filter({ hasText: 'layer.createRaster: completed' })
    .waitFor({ timeout: 15_000 });
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before + 1
  );

  const undo = panel.locator('details').filter({ hasText: 'history.undo' });
  await undo.locator('summary').click();
  const undoButton = undo.getByRole('button', { name: 'Run' });
  await undoButton.waitFor();
  await undoButton.click();
  await panel.getByRole('status').filter({ hasText: 'history.undo: completed' })
    .waitFor({ timeout: 15_000 });
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before
  );

  await window.screenshot({ path: screenshot });
  if (pageErrors.length) throw new Error(`Actions panel page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Desktop Actions panel smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
