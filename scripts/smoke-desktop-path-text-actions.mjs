import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const outputDirectory = path.join(root, 'tmp', 'path-text-actions-smoke');
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
    pageErrors, label: 'path-text-actions'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const beforeLayerIds = await window.locator('.lighttable-layer[data-layer-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.layerId));
  const beforeLayers = beforeLayerIds.length;

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  const bounds = await window.locator('.lighttable-viewport').boundingBox();
  if (!bounds) throw new Error('Path Text smoke could not measure the viewport.');
  const point = (x, y) => ({ x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });

  await window.keyboard.press('p');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Pen' }).waitFor();
  for (const [x, y] of [[0.16, 0.28], [0.3, 0.2], [0.38, 0.42]]) {
    const anchor = point(x, y);
    await window.mouse.click(anchor.x, anchor.y);
  }
  await window.keyboard.press('Enter');
  const vectorStep = recorder.locator('li').filter({ hasText: 'vector.create' });
  await vectorStep.waitFor({ timeout: 15_000 });

  await window.keyboard.press('Shift+a');
  await window.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Direct selection' }).waitFor();
  const pathAnchor = point(0.16, 0.28);
  await window.mouse.click(pathAnchor.x, pathAnchor.y);

  await window.getByRole('button', { name: 'Show text tools' }).click();
  await window.getByRole('toolbar', { name: 'Text tools' })
    .getByRole('button', { name: 'Path text (T)', exact: true }).click();
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Path text' }).waitFor();
  const textOrigin = point(0.24, 0.3);
  await window.mouse.click(textOrigin.x, textOrigin.y);
  const textInput = window.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached', timeout: 30_000 }).catch(async () => {
    const evidence = await window.evaluate(() => ({
      tool: document.querySelector('.lighttable-tool-options__identity')?.textContent,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      body: document.body.innerText.match(/Path text[^\n]*/gi)?.slice(-5) ?? []
    }));
    throw new Error(`Path Text editor did not open: ${JSON.stringify({
      evidence, recorder: await recorder.textContent()
    })}`);
  });
  await textInput.press('Escape');
  if (!await panel.count()) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  const textStep = recorder.locator('li').filter({ hasText: 'text.create' });
  await textStep.waitFor({ timeout: 30_000 }).catch(async () => {
    throw new Error(`Path Text did not publish text.create: ${await recorder.textContent()}`);
  });
  await textStep.locator('summary').click();
  const text = await textStep.textContent();
  if (!text?.includes('"mode": "path"') || !text.includes('$step1.layerId')
    || !text.includes('$step1.elementId') || !text.includes('"side": "left"')) {
    throw new Error(`Path Text Action lost its native path binding: ${text}`);
  }
  const recordingEvidence = await recorder.textContent();

  await recorder.getByRole('button', { name: 'Stop' }).click();
  await panel.getByRole('radio', { name: 'Commands' }).click();
  for (let index = 0; index < 2; index += 1) {
    const undo = panel.locator('details').filter({ hasText: 'history.undo' });
    const run = undo.getByRole('button', { name: 'Run' });
    if (!await run.isVisible()) await undo.locator('summary').click();
    await run.click();
  }
  await window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count,
  beforeLayers);
  await panel.getByRole('radio', { name: 'Actions' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await window.waitForFunction((existingLayerIds) =>
    [...document.querySelectorAll('.lighttable-layer[data-layer-id]')]
      .some((node) => !existingLayerIds.includes(node.dataset.layerId)),
  beforeLayerIds, { timeout: 30_000 }).catch(async () => {
    const evidence = await window.evaluate(() => ({
      body: document.body.innerText.slice(-4000),
      layers: window.__lightTableAutomation?.queryLayers(
        window.__lightTableAutomation?.queryWorkspace()?.activeDocumentId
      )
    })).catch(() => null);
    throw new Error(`Path Text playback did not recreate a layer: ${JSON.stringify({
      evidence, recordingEvidence, pageErrors
    })}`);
  });
  if (!await panel.count()) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 30_000 });
  const replayed = await window.evaluate((existingLayerIds) => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    const layers = documentId ? driver?.queryLayers(documentId) : null;
    const textLayer = layers?.find((layer) =>
      layer.type === 'text' && !existingLayerIds.includes(layer.id));
    return documentId && textLayer ? driver?.queryText(documentId, textLayer.id) : null;
  }, beforeLayerIds);
  if (replayed?.layout?.mode !== 'path') {
    throw new Error(`Replayed text is not path-bound: ${JSON.stringify(replayed)}`);
  }
  if (pageErrors.length) throw new Error(`Path Text page errors: ${pageErrors.join(' | ')}`);
  console.log('Desktop Path Text Actions smoke passed.');
} finally {
  await app?.close();
}
