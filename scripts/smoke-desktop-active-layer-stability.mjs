import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const outputDirectory = path.join(root, 'tmp', 'active-layer-stability-smoke');
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
    pageErrors, label: 'active-layer-stability'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });

  const documentState = () => window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    return documentId ? driver?.queryDocument(documentId) : null;
  });
  const layerRows = window.locator('.lighttable-layer[data-layer-id]');
  const rasterRows = window.locator('.lighttable-layer[aria-label*="raster layer"]');
  const originalLayerId = await rasterRows.first().getAttribute('data-layer-id');
  if (!originalLayerId) throw new Error('Active-layer smoke found no imported raster layer.');
  const beforeIds = await layerRows.evaluateAll((rows) => rows.map((row) => row.dataset.layerId));
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  await window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count + 1,
  beforeIds.length);
  const afterIds = await layerRows.evaluateAll((rows) => rows.map((row) => row.dataset.layerId));
  const paintLayerId = afterIds.find((id) => id && !beforeIds.includes(id));
  if (!paintLayerId) throw new Error(`New raster layer is missing: ${JSON.stringify(afterIds)}`);

  const selectLayer = async (layerId) => {
    await window.locator(`.lighttable-layer[data-layer-id="${layerId}"]`).click();
    await window.waitForFunction((expected) => {
      const driver = window.__lightTableAutomation;
      const documentId = driver?.queryWorkspace()?.activeDocumentId;
      return documentId && driver?.queryDocument(documentId)?.activeLayerId === expected;
    }, layerId);
  };
  const assertSelectionStays = async (layerId, label) => {
    await selectLayer(layerId);
    await window.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 150)))));
    const state = await documentState();
    if (state?.activeLayerId !== layerId) {
      throw new Error(`${label} reverted the active layer: ${JSON.stringify(state)}`);
    }
  };
  const viewportPoint = async (x, y) => {
    const bounds = await window.locator('.lighttable-viewport').boundingBox();
    if (!bounds) throw new Error('Active-layer smoke could not measure the viewport.');
    return { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
  };
  const waitForUndoDepth = (depth) => window.waitForFunction((expected) => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    return documentId && driver?.queryDocument(documentId)?.history.undoDepth === expected;
  }, depth);

  let undoDepth = (await documentState())?.history.undoDepth ?? 0;
  await selectLayer(paintLayerId);
  await window.getByRole('button', { name: 'Show gradient and fill tools', exact: true }).click();
  await window.getByRole('button', { name: 'Paint bucket (G)', exact: true }).click();
  const fillPoint = await viewportPoint(0.2, 0.42);
  await window.mouse.click(fillPoint.x, fillPoint.y);
  await waitForUndoDepth(++undoDepth);
  await assertSelectionStays(originalLayerId, 'Fill');

  await selectLayer(paintLayerId);
  await window.getByRole('button', { name: 'Show gradient and fill tools', exact: true }).click();
  await window.getByRole('button', { name: 'Gradient (G)', exact: true }).click();
  await window.getByRole('combobox', { name: 'Gradient application' }).selectOption('pixels');
  const gradientStart = await viewportPoint(0.18, 0.5);
  const gradientEnd = await viewportPoint(0.34, 0.62);
  await window.mouse.move(gradientStart.x, gradientStart.y);
  await window.mouse.down();
  await window.mouse.move(gradientEnd.x, gradientEnd.y, { steps: 18 });
  await window.mouse.up();
  await waitForUndoDepth(++undoDepth);
  await assertSelectionStays(originalLayerId, 'Raster Gradient');

  await selectLayer(paintLayerId);
  await window.keyboard.press('b');
  const brushStart = await viewportPoint(0.2, 0.32);
  const brushEnd = await viewportPoint(0.36, 0.46);
  await window.mouse.move(brushStart.x, brushStart.y);
  await window.mouse.down();
  await window.mouse.move(brushEnd.x, brushEnd.y, { steps: 24 });
  await window.mouse.up();
  await waitForUndoDepth(++undoDepth);
  await assertSelectionStays(originalLayerId, 'Brush');

  await window.keyboard.press('Control+z');
  await waitForUndoDepth(undoDepth - 1);
  await window.keyboard.press('Control+Shift+z');
  await waitForUndoDepth(undoDepth);
  await assertSelectionStays(originalLayerId, 'Redo followed by layer selection');
  if (pageErrors.length) throw new Error(`Active-layer page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop active-layer stability smoke passed.');
} finally {
  await app?.close();
}
