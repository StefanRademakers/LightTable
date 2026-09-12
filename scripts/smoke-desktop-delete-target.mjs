import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { verifyDeleteTransformHandoff } from './delete-target-transform-handoff.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'delete-target-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { checks: [], pageErrors: [] }; let app, page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  report.executablePath = launch.executablePath;
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'delete-target' });
  const driver = await attachLightTableAutomation(page, 'delete-target');
  const created = await driver.executeWorkspace('document.create', { name: 'Delete target', width: 400, height: 300,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#e0d0b0' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const state = () => driver.queryDocument(id);
  const layers = () => driver.queryLayers(id);
  const pixels = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId);
    const artifact = await driver.readArtifact(task.artifact.id);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const waitDepth = async depth => page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation.queryDocument(id).history.undoDepth === depth,
  { id, depth }, { timeout: 10000 });

  // Real shape gesture and Path Selection click establish a vector sub-selection.
  await page.keyboard.press('u');
  await page.getByRole('button', { name: 'Rectangle (U)', exact: true }).waitFor();
  const viewport = await page.locator('.lighttable-viewport').boundingBox(); assert.ok(viewport);
  const first = { x: viewport.x + viewport.width * .28, y: viewport.y + viewport.height * .35 };
  const second = { x: viewport.x + viewport.width * .43, y: viewport.y + viewport.height * .55 };
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  await page.mouse.move(second.x, second.y, { steps: 5 }); await page.mouse.up();
  const vectorId = (await state()).activeLayerId;
  const beforeVector = (await layers()).find(layer => layer.id === vectorId);
  assert.equal(beforeVector.type, 'vector'); assert.equal(beforeVector.vectorContent.elements.length, 1);
  await page.keyboard.press('a');
  await page.getByRole('button', { name: 'Path selection (A)', exact: true }).waitFor();
  await page.mouse.click((first.x + second.x) / 2, (first.y + second.y) / 2);
  await driver.execute(id, 'selection.modify', { kind: 'modify', operation: 'all' });
  const vectorPixels = await pixels('vector-before-delete');
  const depth = (await state()).history.undoDepth;
  await page.keyboard.press('Delete'); await waitDepth(depth + 1);
  const afterVector = (await layers()).find(layer => layer.id === vectorId);
  assert.ok(afterVector, 'Vector sub-selection Delete must retain the layer');
  assert.equal(afterVector.vectorContent.elements.length, 0, 'Vector selection must take precedence over pixel selection');
  assert.notDeepEqual(await pixels('vector-after-delete'), vectorPixels);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await layers()).find(layer => layer.id === vectorId).vectorContent, beforeVector.vectorContent);
  assert.deepEqual(await pixels('vector-undo'), vectorPixels);
  report.checks.push('Actual vector selection takes precedence over active pixel selection; layer retained and exact undo');

  // Real panel multi-selection must delete exactly those layers, not a stale active target.
  await driver.execute(id, 'selection.modify', { kind: 'modify', operation: 'clear' });
  await page.keyboard.press('m');
  const firstRaster = (await driver.execute(id, 'layer.createRaster', {})).value.layerId;
  const secondRaster = (await driver.execute(id, 'layer.createRaster', {})).value.layerId;
  const row = layerId => page.locator(`.lighttable-layer[data-layer-id="${layerId}"]`);
  await row(firstRaster).click(); await row(secondRaster).click({ modifiers: ['Control'] });
  const selected = await page.locator('.lighttable-layer--selected').evaluateAll(nodes => nodes.map(node => node.dataset.layerId));
  assert.deepEqual(selected.sort(), [firstRaster, secondRaster].sort());
  const beforeLayers = (await layers()).map(layer => layer.id), beforeDepth = (await state()).history.undoDepth;
  await page.keyboard.press('Delete'); await waitDepth(beforeDepth + 1);
  const afterLayers = (await layers()).map(layer => layer.id);
  assert.deepEqual(afterLayers, beforeLayers.filter(layerId => !selected.includes(layerId)));
  await driver.execute(id, 'history.undo', {}); assert.deepEqual((await layers()).map(layer => layer.id), beforeLayers);
  await driver.execute(id, 'history.redo', {}); assert.deepEqual((await layers()).map(layer => layer.id), afterLayers);
  report.checks.push('Actual panel multi-selection Delete removes exact IDs in one history step with exact tree UndoRedo');
  report.checks.push(await verifyDeleteTransformHandoff(page, driver));
  assert.deepEqual(report.pageErrors, []); report.passed = true;
  await page.screenshot({ path: path.join(output, 'final-ui.png') });
  console.log(`Delete target gate passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); report.body = await page.locator('body').innerText(); }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
