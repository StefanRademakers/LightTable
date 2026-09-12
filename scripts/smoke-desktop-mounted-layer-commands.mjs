import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { prepareRasterSmokeSource } from './desktop-smoke-fixtures.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.join(root, 'tmp', 'mounted-layer-commands-smoke');
await mkdir(outputDirectory, { recursive: true });
const fixture = await prepareRasterSmokeSource(outputDirectory, process.argv[2]);
const userData = await mkdtemp(path.join(outputDirectory, 'profile-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const observations = [];
const pageErrors = [];
let app;
let page;
try {
  const launch = await resolveDesktopTestLaunch(root);
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture }, timeout: 30_000 });
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory, sourceFile: fixture,
    pageErrors, label: 'mounted-layer-commands' });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'mounted-layer-commands');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  assert.ok(documentId, 'Opening fixture must select a document');
  await driver.waitForReadyDocument(documentId);
  const layers = () => driver.queryLayers(documentId);
  const tree = async () => (await layers()).map(({ id, type, parentId, name }) => ({ id, type, parentId, name }));
  const depth = async () => (await driver.queryDocument(documentId)).history.undoDepth;
  const roundTrip = async (command, parameters, resultField, expectedType) => {
    const before = await tree(); const beforeDepth = await depth();
    const result = await driver.execute(documentId, command, parameters);
    const id = result.value?.[resultField];
    assert.equal(typeof id, 'string', `${command} must return its admitted output ID`);
    const after = await tree();
    assert.equal(after.find(layer => layer.id === id)?.type, expectedType);
    assert.ok(!before.some(layer => layer.id === id), `${command} returned an existing layer ID`);
    assert.equal(await depth(), beforeDepth + 1, `${command} must create exactly one history entry`);
    await driver.execute(documentId, 'history.undo', {});
    assert.deepEqual(await tree(), before, `${command}: one undo must restore the exact prior layer tree`);
    assert.equal(await depth(), beforeDepth);
    await driver.execute(documentId, 'history.redo', {});
    assert.deepEqual(await tree(), after, `${command}: one redo must restore the same output IDs`);
    assert.equal(await depth(), beforeDepth + 1);
    observations.push({ command, result: result.value, historyDelta: 1, undoRedo: 'passed' });
    return id;
  };

  const gradientId = await roundTrip('layer.createGradientFill', {}, 'layerId', 'vector');
  const groupId = await roundTrip('layer.createGroup', {}, 'layerId', 'group');
  const selection = [gradientId, groupId];
  const selectionGroupId = await roundTrip('layer.group', { layerIds: selection }, 'groupId', 'group');
  for (const id of selection) assert.equal((await layers()).find(layer => layer.id === id)?.parentId, selectionGroupId);
  const duplicateId = await roundTrip('layer.duplicate', { layerId: gradientId }, 'layerId', 'vector');
  assert.notEqual(duplicateId, gradientId);

  // A real panel command is recorded, then a dependent rename exercises the output-ID binding on replay.
  const beforeUi = await tree(); const beforeUiDepth = await depth();
  await driver.startActionRecording('Mounted layer command result binding');
  await page.getByRole('button', { name: 'Layers menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New group', exact: true }).click();
  await page.waitForFunction(id => window.__lightTableAutomation.actionRecordingSnapshot().steps
    .some(step => step.command === 'layer.createGroup')
    && window.__lightTableAutomation.queryDocument(id).history.canUndo, documentId);
  const uiCreated = (await tree()).filter(layer => !beforeUi.some(before => before.id === layer.id));
  assert.equal(uiCreated.length, 1); assert.equal(uiCreated[0].type, 'group');
  const replayName = 'O06c replay result owner';
  await driver.execute(documentId, 'layer.rename', { layerId: uiCreated[0].id, name: replayName });
  await driver.stopActionRecording();
  const recording = await driver.queryActionRecording();
  assert.deepEqual(recording.steps.map(step => step.command), ['layer.createGroup', 'layer.rename']);
  assert.equal(recording.steps[1].parameters.layerId?.$lighttableResult?.step, 1);
  assert.equal(recording.steps[1].parameters.layerId?.$lighttableResult?.path, 'layerId');
  assert.equal(await depth(), beforeUiDepth + 2);
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual(await tree(), beforeUi);

  const panel = page.getByRole('complementary', { name: 'Actions' });
  const tab = page.getByRole('tab', { name: 'Actions', exact: true });
  if (!await panel.isVisible()) {
    if (await tab.isVisible()) await tab.click();
    else {
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Actions panel', exact: true }).click();
      if (await tab.isVisible()) await tab.click();
    }
  }
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' }).waitFor({ timeout: 30_000 });
  const replayed = (await tree()).filter(layer => !beforeUi.some(before => before.id === layer.id));
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].type, 'group'); assert.equal(replayed[0].name, replayName);
  assert.notEqual(replayed[0].id, uiCreated[0].id, 'Replay must bind its newly created output, not reuse the recorded ID');
  assert.equal(await depth(), beforeUiDepth + 2);
  observations.push({ ui: 'Layers menu → New group', recording, replayed, actions: 'passed' });
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(outputDirectory, 'final.png') });
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ passed: true, observations, pageErrors }, null, 2));
  console.log('Mounted layer commands, exact output IDs, one-step history and UI/Actions replay passed.');
} catch (error) {
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ passed: false,
    error: error.stack ?? String(error), observations, pageErrors }, null, 2));
  if (page) await page.screenshot({ path: path.join(outputDirectory, 'failure.png') });
  throw error;
} finally {
  await app?.close();
}
