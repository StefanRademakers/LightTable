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
  await window.evaluate(() => {
    globalThis.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__ = [];
    globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__ = [];
  });
  await recorder.getByRole('button', { name: 'Record' }).click();
  await window.getByRole('button', { name: 'Magic Wand (W)', exact: true }).first().click();
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Magic Wand' }).waitFor();
  const clickPoint = await window.evaluate(() => {
    const canvas = document.querySelector('.lighttable-viewport__canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const bounds = canvas.getBoundingClientRect();
    for (const yRatio of [0.42, 0.58, 0.3, 0.7]) {
      for (const xRatio of [0.18, 0.32, 0.5, 0.68]) {
        const x = bounds.left + bounds.width * xRatio;
        const y = bounds.top + bounds.height * yRatio;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
    }
    return null;
  });
  if (!clickPoint) throw new Error('Magic Wand smoke found no unobstructed canvas point.');
  await window.mouse.click(clickPoint.x, clickPoint.y);

  const step = recorder.locator('[data-command="selection.applyMagicWand"]');
  await step.waitFor({ timeout: 30_000 }).catch(async () => {
    const trace = await window.evaluate(() => ({
      observation: globalThis.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__,
      magicWand: globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__,
    }));
    throw new Error(
      `Magic Wand Action did not publish: ${await recorder.textContent()} ${JSON.stringify(trace)}`,
    );
  });
  if (await step.count() !== 1) throw new Error('Magic Wand published more than one Action.');
  await recorder.getByRole('button', { name: 'Stop' }).click();
  await step.click();
  const inspector = recorder.locator('.lighttable-action-inspector');
  await inspector.locator('summary').click();
  const text = await inspector.textContent();
  const values = await inspector.locator('input').evaluateAll((inputs) => (
    inputs.map((input) => input instanceof HTMLInputElement ? input.value : '')
  ));
  if (!text?.includes('Selection kind') || !text.includes('Source layer ID')
    || !text.includes('Document sample point') || !text.includes('Magic Wand options')
    || !values.includes(rasterTargetId) || !values.includes('20')
    || text.includes('documentRevision') || text.includes('Raster mask')) {
    throw new Error(
      `Magic Wand Action lost its sampled recipe boundary: ${JSON.stringify({ text, values })}`,
    );
  }

  await window.keyboard.press('Control+z');
  await window.waitForTimeout(250);
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
