import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'mask-kernel-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const timings = [];
let app;

const timed = async (operation, work) => {
  const startedAt = performance.now();
  const result = await work();
  timings.push({ operation, durationMs: performance.now() - startedAt });
  return result;
};

const previewPixels = async (driver, documentId) => {
  const state = await driver.queryDocument(documentId);
  const preview = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 256);
  const artifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
  assert.ok(artifact?.bytes?.length);
  return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'mask-kernel' });
  const driver = await attachLightTableAutomation(page, 'mask-kernel');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Mask kernel', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#4d80b3' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId);
  await driver.waitForRenderedDocument(documentId, 60_000);
  let layer = (await driver.queryLayers(documentId))[0];
  assert.ok(layer?.id);
  const originalLayerId = layer.id;

  await timed('add-mask', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'add', source: 'reveal-all'
  }));
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.equal(layer.maskContent.raster.enabled, true);

  await timed('disable-mask', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'set-enabled', enabled: false
  }));
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.equal(layer.maskContent.raster.enabled, false);
  await driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'set-enabled', enabled: true
  });
  await driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'set-linked', linked: false
  });

  const beforeInvert = layer.maskContent.raster.pixelRevision;
  await timed('invert-mask', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'invert'
  }));
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.ok(layer.maskContent.raster.pixelRevision > beforeInvert);
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.redo', {});
  await driver.execute(documentId, 'history.undo', {});

  await timed('load-mask-selection', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'load-selection'
  }));
  const copied = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
  assert.deepEqual(copied.value?.bounds, { x: 0, y: 0, width: 256, height: 192 });

  await timed('delete-mask', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'remove'
  }));
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.equal(layer.hasMask, false);
  await driver.execute(documentId, 'history.undo', {});
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.equal(layer.hasMask, true);
  await driver.execute(documentId, 'history.redo', {});
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.equal(layer.hasMask, false);

  await driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'add', source: 'reveal-all'
  });
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  const beforePaintRevision = layer.maskContent.raster.pixelRevision;
  const beforePaintDocument = await driver.queryDocument(documentId);
  const gesture = await driver.beginGesture({ documentId, kind: 'brush-stroke',
    coordinateSpace: 'document', parameters: { layerId: originalLayerId, channel: 'mask' },
    sample: { x: 80, y: 70, pressure: 1 }, pointerId: 901 });
  assert.equal(gesture.status, 'started', JSON.stringify(gesture));
  await driver.updateGesture(gesture.gestureId, [{ x: 130, y: 90, pressure: 1 }]);
  await driver.finishGesture(gesture.gestureId, true);
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth,
  { id: documentId, depth: beforePaintDocument.history.undoDepth + 1 }, { timeout: 30_000 });
  layer = (await driver.queryLayers(documentId)).find(({ id }) => id === originalLayerId);
  assert.ok(layer.maskContent.raster.pixelRevision > beforePaintRevision);
  timings.push({ operation: 'paint-mask', durationMs: null });
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.redo', {});

  const beforeApply = await previewPixels(driver, documentId);
  await timed('apply-mask', () => driver.execute(documentId, 'layer.setMask', {
    layerId: originalLayerId, operation: 'apply'
  }));
  const appliedLayers = await driver.queryLayers(documentId);
  assert.equal(appliedLayers.some(({ id }) => id === originalLayerId), true);
  assert.equal(appliedLayers.length, 1);
  assert.equal(appliedLayers[0].type, 'raster');
  assert.equal(appliedLayers[0].hasMask, false);
  const afterApply = await previewPixels(driver, documentId);
  assert.deepEqual(afterApply.info, beforeApply.info);
  let squaredError = 0;
  for (let index = 0; index < beforeApply.data.length; index += 1) {
    const delta = beforeApply.data[index] - afterApply.data[index];
    squaredError += delta * delta;
  }
  const applyRmse = Math.sqrt(squaredError / beforeApply.data.length);
  assert.ok(applyRmse <= 2, `Apply mask changed appearance (RMSE ${applyRmse}).`);
  timings.push({ operation: 'apply-mask-rmse', value: applyRmse });
  await driver.execute(documentId, 'history.undo', {});
  assert.equal((await driver.queryLayers(documentId)).some(
    ({ id, hasMask }) => id === originalLayerId && hasMask), true);

  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  const report = { documentId, timings, pageErrors };
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Packaged mask kernel smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
