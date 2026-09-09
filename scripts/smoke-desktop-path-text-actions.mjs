import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { prepareRasterSmokeSource } from './desktop-smoke-fixtures.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'path-text-actions-smoke');
const fixture = await prepareRasterSmokeSource(outputDirectory, process.argv[2]);
await mkdir(outputDirectory, { recursive: true });
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
  await window.evaluate(() => { window.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__ = []; });
  const driver = await attachLightTableAutomation(window, 'path-text-actions');
  const waitForRecorded = (command, count = 1) => window.waitForFunction(({ command, count }) =>
    window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
      .filter((step) => step.command === command).length >= count,
  { command, count }, { timeout: 30_000 });
  const beforeLayerIds = await window.locator('.lighttable-layer[data-layer-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.layerId));
  const beforeLayers = beforeLayerIds.length;

  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  const ensureActionsPanel = async () => {
    if (await panel.isVisible().catch(() => false)) return;
    const tab = window.getByRole('tab', { name: 'Actions', exact: true });
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
    } else {
      await window.getByRole('menuitem', { name: 'View' }).click();
      await window.getByRole('menuitem', { name: 'Actions panel' }).click();
      if (await tab.isVisible().catch(() => false)) await tab.click();
    }
    await panel.waitFor({ state: 'visible', timeout: 30_000 });
  };
  await ensureActionsPanel();
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
  await window.evaluate(() => document.activeElement instanceof HTMLElement
    && document.activeElement.blur());
  await window.keyboard.press('Enter');
  await window.keyboard.press('Shift+a');
  await window.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Direct selection' }).waitFor();
  await waitForRecorded('vector.create').catch(async (error) => {
    const workspace = await driver.queryWorkspace();
    const layers = workspace?.activeDocumentId
      ? await driver.queryLayers(workspace.activeDocumentId) : [];
    const evidence = await window.evaluate(() => ({
      tool: document.querySelector('.lighttable-tool-options__identity')?.textContent,
      layers: [...document.querySelectorAll('.lighttable-layer[data-layer-id]')]
        .map((node) => ({ id: node.dataset.layerId, text: node.textContent })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      commandObservationTrace: window.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__
    }));
    throw new Error(`Pen path did not publish vector.create: ${JSON.stringify({
      evidence, workspace, layers,
      vectors: workspace?.activeDocumentId ? await Promise.all((layers ?? [])
        .filter(({ type }) => type === 'vector')
        .map(({ id }) => driver.queryVector(workspace.activeDocumentId, id))) : [],
      recorder: await recorder.textContent(), pageErrors
    })}`, { cause: error });
  });

  const pathAnchor = point(0.16, 0.28);
  await window.mouse.click(pathAnchor.x, pathAnchor.y);

  await window.locator('[data-tool-group="Text tools"] > .ui-toolbar__button').click();
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
  await ensureActionsPanel();
  await waitForRecorded('text.create').catch(async () => {
    throw new Error(`Path Text did not publish text.create: ${JSON.stringify(
      await driver.queryActionRecording()
    )}`);
  });
  const textStep = (await driver.queryActionRecording())?.steps
    .find(({ command }) => command === 'text.create');
  const pathBinding = textStep?.parameters?.path;
  if (textStep?.parameters?.mode !== 'path'
    || pathBinding?.layerId?.$lighttableResult?.step !== 1
    || pathBinding?.layerId?.$lighttableResult?.path !== 'layerId'
    || pathBinding?.elementId?.$lighttableResult?.step !== 1
    || pathBinding?.elementId?.$lighttableResult?.path !== 'elementId'
    || pathBinding?.side !== 'left') {
    throw new Error(`Path Text Action lost its native path binding: ${JSON.stringify(textStep)}`);
  }
  const recordingEvidence = JSON.stringify(await driver.queryActionRecording());

  await recorder.getByRole('button', { name: 'Stop' }).click();
  for (let index = 0; index < 2; index += 1) {
    await window.keyboard.press('Control+z');
  }
  await window.waitForFunction((count) =>
    document.querySelectorAll('.lighttable-layer[data-layer-id]').length === count,
  beforeLayers);
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
  await ensureActionsPanel();
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
