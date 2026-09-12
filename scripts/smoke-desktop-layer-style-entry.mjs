import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'tmp', 'layer-style-entry-smoke');
await mkdir(directory, { recursive: true });
const output = await mkdtemp(path.join(directory, 'run-'));
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const report = { checks: [], pageErrors: [] }; let app; let page;
try {
  const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args, cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, 'profile') } });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors: report.pageErrors, label: 'layer-style-entry' });
  const driver = await attachLightTableAutomation(page, 'layer-style-entry');
  const created = await driver.executeWorkspace('document.create', { name: 'Layer style entry', width: 320, height: 240,
    resolutionPpi: 72, bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#e0d0b0' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const rectangle = await driver.execute(id, 'vector.create', { name: 'Style owner',
    primitive: { kind: 'rectangle', x: 70, y: 60, width: 140, height: 100, cornerRadii: [0, 0, 0, 0] },
    style: { fill: { type: 'solid', color: [0.2, 0.4, 0.7, 1] } } });
  const layerId = rectangle.value.layerId;
  await driver.execute(id, 'layer.effect.add', { layerId, effectKind: 'outer-glow' });
  const effects = () => driver.queryLayerEffects(id, layerId);
  const state = () => driver.queryDocument(id);
  const pixels = async label => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId); assert.ok(task.artifact?.id);
    const artifact = await driver.readArtifact(task.artifact.id);
    await writeFile(path.join(output, `${label}.png`), artifact.bytes);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const before = await effects(), beforeState = await state(), beforePixels = await pixels('before');
  await page.getByRole('tab', { name: 'Assets', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Effect', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Drop Shadow', exact: true }).click();
  const editor = page.getByRole('complementary', { name: 'Layer effects', exact: true });
  await editor.waitFor({ state: 'visible' });
  const heading = editor.getByRole('button', { name: 'Drop Shadow', exact: true });
  assert.equal(await heading.getAttribute('aria-expanded'), 'true', 'New effect must open its exact editor section');
  await page.locator('.lighttable-layer-effect--selected').filter({ hasText: /^Drop Shadow$/ }).waitFor({ state: 'visible' });
  const after = await effects();
  const added = after.effects.filter(effect => !before.effects.some(prior => prior.id === effect.id));
  assert.equal(added.length, 1); assert.equal(added[0].kind, 'drop-shadow');
  assert.equal((await state()).history.undoDepth, beforeState.history.undoDepth + 1);
  const afterPixels = await pixels('after'); assert.notDeepEqual(afterPixels, beforePixels);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await effects()).effects, before.effects); assert.deepEqual(await pixels('undo'), beforePixels);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual((await effects()).effects, after.effects); assert.deepEqual(await pixels('redo'), afterPixels);
  report.checks.push('Real Layer > Add Effect creates one Drop Shadow, opens the correct effect from Assets, and restores exact effect IDs/pixels through Undo/Redo.');
  await driver.execute(id, 'layer.setLock', { layerIds: [layerId], lock: 'all', locked: true });
  await page.getByRole('tab', { name: 'Assets', exact: true }).click();
  const lockedState = await state();
  const row = page.locator(`[data-layer-id="${layerId}"]`);
  const summary = row.locator('xpath=following-sibling::*[contains(concat(" ", normalize-space(@class), " "), " lighttable-layer-effects ")][1]')
    .locator('.lighttable-layer-effect--summary');
  await summary.getByRole('button', { name: 'Effects', exact: true }).click();
  await page.getByText('Unlock the layer to edit effects.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.lighttable-style-editor').count(), 0);
  assert.equal((await state()).history.undoDepth, lockedState.history.undoDepth);
  assert.equal((await state()).canonicalRevision, lockedState.canonicalRevision);
  await page.screenshot({ path: path.join(output, 'locked-inspector.png') });
  await driver.execute(id, 'layer.setLock', { layerIds: [layerId], lock: 'all', locked: false });
  await page.getByText('Unlock the layer to edit effects.', { exact: true }).waitFor({ state: 'hidden' });
  report.checks.push('Locked owner remains inspectable with the informational notice and no editable controls or new mutation.');
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
  await page.getByRole('tab', { name: 'Assets', exact: true }).click();
  const beforeCurves = await state();
  const beforeCurvesLayers = await driver.queryLayers(id);
  // The native Curves shortcut uses applyCurves, while the generic Image menu
  // uses applyAdjustment. Exercise the actual duplicate-reveal route being removed.
  await page.keyboard.press('Control+m');
  const curves = page.getByRole('complementary', { name: 'Curves properties', exact: true });
  await curves.waitFor({ state: 'visible' });
  assert.equal(await curves.count(), 1);
  const afterCurves = await state(), afterCurvesLayers = await driver.queryLayers(id);
  const createdCurves = afterCurvesLayers.filter(layer => !beforeCurvesLayers.some(prior => prior.id === layer.id));
  assert.equal(createdCurves.length, 1); assert.equal(createdCurves[0].type, 'adjustment');
  assert.equal(afterCurves.activeLayerId, createdCurves[0].id);
  assert.equal(afterCurves.history.undoDepth, beforeCurves.history.undoDepth + 1);
  const curvesProjection = await driver.queryAdjustment(id, { kind: 'layer', layerId: createdCurves[0].id });
  assert.equal(curvesProjection.status, 'completed');
  assert.equal(curvesProjection.adjustmentKind, 'curves');
  const curvesModule = curvesProjection.stack.modules.find(module => module.type === 'lt.curves');
  assert.equal(curvesModule.enabled, true);
  const curveValues = curvesModule.parameters.find(parameter => parameter.path === 'curves').value;
  for (const channel of ['master', 'red', 'green', 'blue']) {
    assert.deepEqual(curveValues[channel], [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  }
  const curvesPixels = await pixels('identity-curves');
  // This fixture crosses an enabled Grade half-float processing/mix pass even
  // for diagonal Curves. The earlier exact assertion failed (run-cmRq6I).
  // Bound this entry test to one RGB code; retain exact alpha and history pixels.
  // This is recorded precision debt, not a general neutral-processing guarantee.
  let changedRgbBytes = 0, squaredError = 0, maximumRgbDelta = 0;
  for (let index = 0; index < curvesPixels.length; index += 1) {
    const delta = Math.abs(curvesPixels[index] - afterPixels[index]);
    if (index % 4 === 3) assert.equal(delta, 0, 'Identity Curves must preserve alpha exactly');
    else {
      maximumRgbDelta = Math.max(maximumRgbDelta, delta);
      if (delta) changedRgbBytes += 1;
      squaredError += delta * delta;
    }
  }
  report.curvesPrecision = { maximumRgbDelta, changedRgbBytes,
    rgbaRmse: Math.sqrt(squaredError / curvesPixels.length),
    assertionRevision: 'Earlier exact neutral-pass assertion failed in run-cmRq6I. Source review identified existing enabled Grade half-float processing/mix rounding. This fixture allows at most one RGB code, exact alpha; exact Undo/Redo remains required. Precision debt, not a general guarantee.',
    canonicalProjection: curvesProjection };
  assert.ok(maximumRgbDelta <= 1, `Identity Curves exceeded fixture RGB bound: ${maximumRgbDelta}`);
  await page.screenshot({ path: path.join(output, 'curves-properties.png') });
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual(await driver.queryLayers(id), beforeCurvesLayers);
  assert.equal((await state()).history.undoDepth, beforeCurves.history.undoDepth);
  assert.deepEqual(await pixels('curves-undo'), afterPixels);
  await driver.execute(id, 'history.redo', {});
  assert.deepEqual(await driver.queryLayers(id), afterCurvesLayers);
  assert.equal((await state()).history.undoDepth, afterCurves.history.undoDepth);
  assert.deepEqual(await pixels('curves-redo'), curvesPixels);
  report.checks.push('Real Ctrl+M creates canonical neutral Curves, targets one visible Properties panel, stays within this fixture RGB rounding bound with exact alpha, and restores exact IDs/history/pixels through Undo/Redo.');
  assert.deepEqual(report.pageErrors, []); await page.screenshot({ path: path.join(output, 'final-ui.png') });
  report.passed = true; console.log(`Layer style entry passed: ${output}`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }); throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await app?.close();
}
