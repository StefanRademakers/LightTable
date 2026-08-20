import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const outputDirectory = path.join(root, 'tmp', 'sampled-brush-actions-smoke');
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
    pageErrors, label: 'sampled-brush-actions'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const rasterTarget = window.locator('.lighttable-layer[aria-label*="raster layer"]').first();
  const rasterTargetId = await rasterTarget.getAttribute('data-layer-id');
  if (!rasterTargetId) throw new Error('Sampled-brush smoke found no raster layer.');
  await rasterTarget.click();
  await window.waitForFunction((layerId) => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    return documentId && driver?.queryDocument(documentId)?.activeLayerId === layerId;
  }, rasterTargetId);
  const baseline = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    const document = documentId ? driver?.queryDocument(documentId) : null;
    return { documentId, layerId: document?.activeLayerId, undoDepth: document?.history.undoDepth };
  });
  if (!baseline.documentId || !baseline.layerId || baseline.undoDepth == null) {
    throw new Error(`Sampled-brush smoke has no active raster target: ${JSON.stringify(baseline)}`);
  }

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  const viewport = window.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Sampled-brush smoke could not measure the viewport.');
  const point = (x, y) => ({ x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });

  await window.keyboard.press('s');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Clone Stamp' }).waitFor();
  await window.getByRole('combobox', { name: 'Sample layers' }).selectOption('all');
  const source = point(0.34, 0.36);
  await window.keyboard.down('Alt');
  await window.mouse.click(source.x, source.y);
  await window.keyboard.up('Alt');
  await window.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' })));
  await window.getByText(/Sample source set at/i).waitFor({ timeout: 15_000 });
  await window.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
    requestAnimationFrame(resolve))));
  if (await recorder.locator('li').count() !== 0) {
    throw new Error('Choosing a sampled-brush source emitted an Action.');
  }

  const destination = point(0.18, 0.5);
  await window.evaluate(() => {
    window.__sampledBrushSmokeEvents = [];
    document.querySelector('.lighttable-viewport')?.addEventListener('pointerdown', (event) => {
      window.__sampledBrushSmokeEvents.push({
        altKey: event.altKey,
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target instanceof Element ? event.target.className : null
      });
    }, { capture: true });
  });
  await window.mouse.move(destination.x, destination.y);
  await window.mouse.down();
  await window.mouse.move(destination.x + 130, destination.y + 45, { steps: 24 });
  if (await recorder.locator('li').filter({ hasText: 'tool.commitGesture' }).count() !== 0) {
    throw new Error('Clone Stamp published before pointer-up.');
  }
  await window.mouse.up();
  await window.waitForFunction(({ documentId, undoDepth }) =>
    window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth + 1,
  baseline, { timeout: 15_000 }).catch(async () => {
    const evidence = await window.evaluate(() => {
      const driver = window.__lightTableAutomation;
      const documentId = driver?.queryWorkspace()?.activeDocumentId;
      return {
        document: documentId ? driver?.queryDocument(documentId) : null,
        tool: document.querySelector('.lighttable-tool-options__identity')?.textContent,
        status: document.body.innerText.match(/Sample source[^\n]*/)?.[0] ?? null,
        errors: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
        events: window.__sampledBrushSmokeEvents
      };
    });
    throw new Error(`Clone Stamp produced no pixel commit: ${JSON.stringify(evidence)}`);
  });
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  const cloneStep = recorder.locator('li').filter({ hasText: 'tool.commitGesture' });
  await cloneStep.waitFor({ timeout: 15_000 }).catch(async () => {
    const evidence = await window.evaluate(() => {
      const driver = window.__lightTableAutomation;
      const id = driver?.queryWorkspace()?.activeDocumentId;
      return { status: document.querySelector('.lighttable-toolbar__meta')?.textContent,
        document: id ? driver?.queryDocument(id) : null,
        actions: document.querySelector('.lighttable-action-recorder')?.textContent };
    });
    throw new Error(`Clone Stamp did not publish after pointer-up: ${JSON.stringify(evidence)}`);
  });
  await cloneStep.locator('summary').click();
  const cloneText = await cloneStep.textContent();
  if (!cloneText?.includes(baseline.layerId) || !cloneText.includes('"operator": "clone"')
    || cloneText.includes('documentId')) {
    throw new Error(`Clone Action lost its target/source contract: ${cloneText}`);
  }

  await panel.getByRole('radio', { name: 'Commands' }).click();
  const undo = panel.locator('details').filter({ hasText: 'history.undo' });
  const runUndo = undo.getByRole('button', { name: 'Run' });
  if (!await runUndo.isVisible()) await undo.locator('summary').click();
  await runUndo.click();
  await window.waitForFunction(({ documentId, undoDepth }) =>
    window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth,
  baseline);
  await panel.getByRole('radio', { name: 'Actions' }).click();
  await recorder.getByRole('button', { name: 'Stop' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 15_000 });
  await window.waitForFunction(({ documentId, undoDepth }) =>
    window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === undoDepth + 1,
  baseline);
  if (pageErrors.length) throw new Error(`Sampled-brush page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop sampled-brush Actions smoke passed.');
} finally {
  await app?.close();
}
