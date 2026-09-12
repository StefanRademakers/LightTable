import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { verifyAdjustmentCreationTransformHandoff } from './adjustment-creation-transform-handoff.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp/adjustment-creation-intents');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const report = { observations: [], pageErrors: [], limitations: [
  'Actual shortcut/menu creation and Actions recording; fixture/history/final exports use public semantic automation.',
  'Exact per-representation Undo/Redo, not neutral Curves pixel parity or whole-app latency certification.'
] };
let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  const archivePath = path.join(path.dirname(launch.executablePath), 'resources/app.asar');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  report.packagedArchive = { path: archivePath, sha256: hash.digest('hex') };
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'adjustment-creation' });
  const driver = await attachLightTableAutomation(page, 'adjustment-creation-intents');
  const created = await driver.executeWorkspace('document.create', { name: 'Adjustment creation', width: 320, height: 200,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#b08050' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const layerId = (await driver.queryDocument(id)).activeLayerId; assert.ok(layerId);
  const state = () => driver.queryDocument(id);
  const detail = () => page.evaluate(request => window.__lightTableAutomation.queryLayerDetail(request), { documentId: id, layerId });
  const pixels = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const initial = await state(), initialPixels = await pixels('initial');
  await page.keyboard.press('Control+m');
  await page.getByRole('complementary', { name: 'Curves properties', exact: true }).waitFor({ state: 'visible' });
  const local = await state();
  assert.equal(local.history.undoDepth, initial.history.undoDepth + 1);
  assert.equal((await driver.queryLayers(id)).length, 1);
  const localStack = (await driver.queryAdjustment(id, { kind: 'layer', layerId })).stack;
  assert.ok(localStack.modules.some(module => module.type === 'lt.curves' && module.enabled));
  const localPixels = await pixels('local-curves');
  for (const route of ['shortcut', 'image-menu']) {
    await page.getByRole('tab', { name: 'Assets', exact: true }).click();
    if (route === 'shortcut') await page.keyboard.press('Control+m');
    else {
      await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Adjustments', exact: true }).hover();
      await page.getByRole('menuitem', { name: 'Curves...', exact: true }).click();
    }
    await page.getByRole('complementary', { name: 'Curves properties', exact: true }).waitFor({ state: 'visible' });
    const revealed = await state();
    assert.equal(revealed.canonicalRevision, local.canonicalRevision);
    assert.deepEqual(revealed.history, local.history);
    assert.deepEqual((await driver.queryAdjustment(id, { kind: 'layer', layerId })).stack, localStack);
  }
  assert.deepEqual(await pixels('repeat-contextual'), localPixels);
  await driver.execute(id, 'history.undo', {}); assert.deepEqual(await pixels('local-undo'), initialPixels);
  await driver.execute(id, 'history.redo', {}); assert.deepEqual(await pixels('local-redo'), localPixels);
  report.observations.push({ kind: 'Ctrl+M first local creation; repeated shortcut and Image menu only reveal',
    oneCreation: true, repeatHasNoRevisionOrHistory: true, exactUndoRedo: true });

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Actions panel', exact: true }).click();
  const recorder = page.getByRole('complementary', { name: 'Actions' }).locator('.lighttable-action-recorder');
  const recordMenuCreate = async attached => {
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    if ((await driver.queryActionRecording()).steps.length) {
      await recorder.getByRole('button', { name: 'Clear', exact: true }).click();
    }
    await recorder.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add Adjustment', exact: true }).hover();
    await page.getByRole('menuitem', { name: attached ? 'Attach Curves to selected layer' : 'Curves', exact: true }).click();
    await page.waitForFunction(() => window.__lightTableAutomation.actionRecordingSnapshot().steps.length === 1);
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await recorder.getByRole('button', { name: 'Stop', exact: true }).click();
    const recording = await driver.queryActionRecording(); assert.equal(recording.steps.length, 1);
    assert.equal(recording.steps[0].command, 'adjustment.create');
    assert.deepEqual(recording.steps[0].parameters, attached
      ? { kind: 'curves', placement: 'attached', layerId }
      : { kind: 'curves', placement: 'adjustment-layer', aboveLayerId: layerId });
    return recording.steps[0];
  };
  const beforeAttached = await state();
  await recordMenuCreate(true);
  const attached = (await detail()).content.attachedAdjustments;
  assert.equal(attached.length, 1); assert.equal(attached[0].adjustmentKind, 'curves');
  assert.equal((await state()).history.undoDepth, beforeAttached.history.undoDepth + 1);
  const attachedPixels = await pixels('attached-curves');
  await driver.execute(id, 'history.undo', {});
  assert.equal((await detail()).content.attachedAdjustments.length, 0);
  assert.deepEqual(await pixels('attached-undo'), localPixels);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await detail()).content.attachedAdjustments, attached);
  assert.deepEqual(await pixels('attached-redo'), attachedPixels);
  const beforeStandalone = await state(), beforeLayers = await driver.queryLayers(id);
  await recordMenuCreate(false);
  const afterLayers = await driver.queryLayers(id);
  const added = afterLayers.filter(layer => !beforeLayers.some(before => before.id === layer.id));
  assert.equal(added.length, 1); assert.equal(added[0].type, 'adjustment');
  assert.equal((await state()).activeLayerId, added[0].id);
  assert.equal((await state()).history.undoDepth, beforeStandalone.history.undoDepth + 1);
  const standalonePixels = await pixels('standalone-curves');
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual(await driver.queryLayers(id), beforeLayers);
  assert.deepEqual(await pixels('standalone-undo'), attachedPixels);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual(await driver.queryLayers(id), afterLayers);
  assert.deepEqual(await pixels('standalone-redo'), standalonePixels);
  await driver.execute(id, 'history.undo', {});
  await page.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__lightTableAutomation.actionPlaybackSnapshot()?.status === 'completed',
    undefined, { timeout: 10000 });
  const replayLayers = await driver.queryLayers(id);
  const replayAdded = replayLayers.filter(layer => !beforeLayers.some(before => before.id === layer.id));
  assert.equal(replayAdded.length, 1); assert.equal(replayAdded[0].type, 'adjustment');
  assert.equal((await state()).history.undoDepth, beforeStandalone.history.undoDepth + 1);
  assert.deepEqual(await pixels('standalone-action-replay'), standalonePixels);
  report.observations.push({ kind: 'explicit attached and standalone menu creation',
    oneActionEach: true, explicitTargets: true, stableNodeIdsUndoRedo: true, exactPixelsUndoRedo: true,
    standaloneActionReplay: { oneNewNode: true, oneHistory: true, exactPixels: true } });
  report.observations.push(await verifyAdjustmentCreationTransformHandoff(page, driver));
  assert.deepEqual(report.pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Adjustment creation intents passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
}
