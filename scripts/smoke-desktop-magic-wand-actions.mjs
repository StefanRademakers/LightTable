import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const outputDirectory = path.join(root, 'tmp', 'magic-wand-actions-smoke');
await Promise.all([access(fixture), mkdir(outputDirectory, { recursive: true })]);
const userData = await mkdtemp(path.join(outputDirectory, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
const pageErrors = [];
try {
  const launch = await resolveDesktopTestLaunch(root);
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
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory, sourceFile: fixture,
    pageErrors, label: 'magic-wand-actions'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });

  const rasterTarget = window.locator('.lighttable-layer[aria-label*="raster layer"]').first();
  const rasterTargetId = await rasterTarget.getAttribute('data-layer-id');
  if (!rasterTargetId) throw new Error('Magic Wand smoke found no raster source layer.');
  await rasterTarget.click();
  await window.waitForFunction((layerId) => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    return documentId && driver?.queryDocument(documentId)?.activeLayerId === layerId;
  }, rasterTargetId);

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await window.getByRole('button', { name: 'Magic Wand (W)', exact: true }).first().click();
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Magic Wand' }).waitFor();
  const bounds = await window.locator('.lighttable-viewport').boundingBox();
  if (!bounds) throw new Error('Magic Wand smoke could not measure the viewport.');
  await window.mouse.click(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.42);

  const step = recorder.locator('li').filter({ hasText: 'selection.applyMagicWand' });
  await step.waitFor({ timeout: 30_000 }).catch(async () => {
    throw new Error(`Magic Wand Action did not publish: ${await recorder.textContent()}`);
  });
  if (await step.count() !== 1) throw new Error('Magic Wand published more than one Action.');
  await step.locator('summary').click();
  const text = await step.textContent();
  if (!text?.includes(rasterTargetId) || !text.includes('"kind": "magic-wand"')
    || !text.includes('"tolerance": 20') || text.includes('documentRevision')
    || text.includes('raster-mask')) {
    throw new Error(`Magic Wand Action lost its sampled recipe boundary: ${text}`);
  }

  await recorder.getByRole('button', { name: 'Stop' }).click();
  await panel.getByRole('radio', { name: 'Commands' }).click();
  const undo = panel.locator('details').filter({ hasText: 'history.undo' });
  const runUndo = undo.getByRole('button', { name: 'Run' });
  if (!await runUndo.isVisible()) await undo.locator('summary').click();
  await runUndo.click();
  await panel.getByRole('radio', { name: 'Actions' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 30_000 }).catch(async () => {
      throw new Error(`Magic Wand playback did not complete: ${await recorder.textContent()}`);
    });
  if (pageErrors.length) throw new Error(`Magic Wand page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop Magic Wand Actions smoke passed.');
} finally {
  await app?.close();
}
