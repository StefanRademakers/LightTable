import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'automation-gestures-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = []; const observations = []; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'automation-gestures' });
  const driver = await attachLightTableAutomation(page, 'automation-gestures');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Automation gesture ownership', width: 512, height: 384, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#303030' }
  });
  const id = created.value?.documentId; assert.ok(id);
  await driver.waitForReadyDocument(id, 60000);
  const command = (name, parameters = {}) => driver.execute(id, name, parameters);
  const state = () => driver.queryDocument(id);
  const layer = async layerId => (await driver.queryLayers(id)).find(layer => layer.id === layerId);
  const pixels = async () => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId);
    assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id); assert.ok(artifact?.bytes?.length);
    return createHash('sha256').update(artifact.bytes).digest('hex');
  };
  const fill = await command('layer.createGradientFill'); const childId = fill.value.layerId;
  const childTransform = { a: 0.25, b: 0, c: 0, d: 0.25, tx: 20, ty: 20 };
  await command('layer.setTransform', { layerId: childId, transform: childTransform });
  const group = await command('layer.group', { layerIds: [childId] });
  await command('layer.setTransform', { layerId: group.value.groupId,
    transform: { a: 0, b: 2, c: -2, d: 0, tx: 400, ty: 20 } });
  const start = async (kind, parameters, sample = { x: 100, y: 100 }) => {
    const result = await driver.beginGesture({ documentId: id, kind, coordinateSpace: 'document', parameters, sample });
    assert.equal(result.status, 'started', JSON.stringify(result)); return result.gestureId;
  };
  const before = await state(); const original = await pixels();
  const gesture = await start('layer-translate', { layerId: childId });
  // A viewport command re-renders command registration, but must not retire this gesture.
  await command('view.setZoom', { mode: 'custom', percent: 80 });
  const update = await driver.updateGesture(gesture, [{ x: 124, y: 116 }]);
  const finished = await driver.finishGesture(gesture, true);
  assert.equal(finished.status, 'completed', JSON.stringify({ update, finished }));
  const translated = (await layer(childId)).transform;
  const expected = { ...childTransform, tx: 28, ty: 8 };
  assert.deepEqual(translated, expected, 'Document-space delta must be mapped through the rotated/scaled parent');
  assert.equal((await state()).history.undoDepth, before.history.undoDepth + 1);
  const moved = await pixels(); assert.notEqual(moved, original);
  await command('history.undo'); assert.deepEqual((await layer(childId)).transform, childTransform);
  assert.equal(await pixels(), original);
  await command('history.redo'); assert.deepEqual((await layer(childId)).transform, expected);
  assert.equal(await pixels(), moved);
  observations.push({ kind: 'parent-space translation across zoom rerender', translated, history: 'one entry/exact PNG undo-redo' });

  const noOpDepth = (await state()).history.undoDepth;
  const noOp = await start('layer-translate', { layerId: childId });
  assert.equal((await driver.finishGesture(noOp, true)).status, 'completed');
  assert.equal((await state()).history.undoDepth, noOpDepth);
  const canceled = await start('layer-translate', { layerId: childId });
  await driver.updateGesture(canceled, [{ x: 140, y: 130 }]);
  await driver.finishGesture(canceled, false);
  assert.deepEqual((await layer(childId)).transform, expected);
  assert.equal(await pixels(), moved); assert.equal((await state()).history.undoDepth, noOpDepth);
  await command('layer.setLock', { layerIds: [childId], lock: 'position', locked: true });
  const locked = await driver.beginGesture({ documentId: id, kind: 'layer-translate', coordinateSpace: 'document',
    parameters: { layerId: childId }, sample: { x: 0, y: 0 } });
  assert.notEqual(locked.status, 'started');
  await command('layer.setLock', { layerIds: [childId], lock: 'position', locked: false });
  observations.push({ kind: 'no-op, cancel and position lock', passed: true });

  const rectangle = await start('selection-rectangle', { mode: 'replace' }, { x: 30, y: 40 });
  await driver.updateGesture(rectangle, [{ x: 130, y: 120 }]);
  assert.equal((await driver.finishGesture(rectangle, true)).status, 'completed');
  const copy = await command('selection.copyPixels', { source: 'merged' });
  assert.deepEqual(copy.value.bounds, { x: 30, y: 40, width: 100, height: 80 });
  const raster = await command('layer.createRaster');
  const paintBefore = await pixels(); const paintDepth = (await state()).history.undoDepth;
  const brush = await start('brush-stroke', { layerId: raster.value.layerId, channel: 'pixels' },
    { x: 55, y: 65, pressure: 1 });
  await driver.updateGesture(brush, [{ x: 100, y: 95, pressure: 1 }]);
  assert.equal((await driver.finishGesture(brush, true)).status, 'completed');
  const painted = await pixels(); assert.notEqual(painted, paintBefore);
  assert.equal((await state()).history.undoDepth, paintDepth + 1);
  await command('history.undo'); assert.equal(await pixels(), paintBefore);
  await command('history.redo'); assert.equal(await pixels(), painted);
  observations.push({ kind: 'selection and brush routed to existing owners', exactUndoRedo: true });
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(output, 'final.png') });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, observations, pageErrors }, null, 2));
  console.log(`Automation gesture ownership passed: ${output}`);
} catch (error) {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, observations, pageErrors,
    error: error.stack ?? String(error) }, null, 2));
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally { await app?.close(); }
