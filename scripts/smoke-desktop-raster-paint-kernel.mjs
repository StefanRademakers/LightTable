import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'raster-paint-kernel-smoke');
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
  const value = await work();
  timings.push({ operation, durationMs: performance.now() - startedAt });
  return value;
};

const brush = {
  presetId: 'round', size: 28, hardness: 0.7, opacity: 0.8,
  flow: 0.35, spacing: 0.12, smooth: 0,
  color: '#101010', backgroundColor: '#ffffff'
};

const gradient = {
  kind: 'gradient',
  asset: {
    id: 's03-gradient', name: 'S03 gradient', type: 'solid', smoothness: 1,
    colorStops: [
      { id: 'a', position: 0, midpoint: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } },
      { id: 'b', position: 1, midpoint: 0.5, color: { r: 0, g: 0, b: 1, a: 1 } }
    ],
    opacityStops: [
      { id: 'oa', position: 0, midpoint: 0.5, opacity: 1 },
      { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
    ],
    roughness: 0, seed: 0
  },
  shape: 'linear', coordinateSpace: 'document',
  transform: { a: 120, b: 0, c: 0, d: 120, tx: 30, ty: 40 },
  reverse: false, dither: false, interpolation: 'perceptual'
};

try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
    timeout: 30_000
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'raster-paint-kernel' });
  const driver = await attachLightTableAutomation(page, 'raster-paint-kernel');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Raster paint kernel', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#4d80b3' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId);
  await driver.waitForReadyDocument(documentId, 60_000);
  const layerId = (await driver.queryLayers(documentId))[0]?.id;
  assert.ok(layerId);

  // Exercise the ordinary toolbar/viewport pointer route once; the remaining
  // matrix uses semantic automation against the same final controllers.
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Brush (B)', exact: true })
    .waitFor({ state: 'visible' });
  const viewport = page.locator('.lighttable-viewport');
  const viewportBounds = await viewport.boundingBox();
  assert.ok(viewportBounds);
  const beforeUiStroke = await driver.queryDocument(documentId);
  const uiStart = { x: viewportBounds.x + viewportBounds.width / 2 - 55,
    y: viewportBounds.y + viewportBounds.height / 2 - 20 };
  await page.mouse.move(uiStart.x, uiStart.y);
  await page.mouse.down();
  await page.mouse.move(uiStart.x + 75, uiStart.y + 35, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth,
  { id: documentId, depth: beforeUiStroke.history.undoDepth + 1 }, { timeout: 30_000 });
  await driver.execute(documentId, 'history.undo', {});

  const preview = async () => {
    const state = await driver.queryDocument(documentId);
    const request = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 256);
    const artifact = await driver.readArtifact(request?.artifact?.id ?? request?.id);
    assert.ok(artifact?.bytes?.length);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const pixel = (image, x, y) => [...image.data.subarray((y * image.info.width + x) * 4,
    (y * image.info.width + x) * 4 + 4)];

  const baseline = await preview();
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 40, y: 35 }, { x: 150, y: 130 }] },
    featherRadius: 0, antiAlias: false
  });
  const beforeFill = await driver.queryDocument(documentId);
  await timed('selection-clipped-fill', () => driver.execute(documentId, 'raster.fill', {
    layerId, channel: 'pixels', color: '#ff2400', preserveTransparency: false, opacity: 1
  }));
  const filled = await preview();
  assert.deepEqual(pixel(filled, 10, 10), pixel(baseline, 10, 10),
    'Fill escaped the committed selection.');
  assert.notDeepEqual(pixel(filled, 80, 70), pixel(baseline, 80, 70),
    'Fill did not affect pixels inside the committed selection.');
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth,
    beforeFill.history.undoDepth + 1);
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await preview()).data, baseline.data, 'Fill undo did not restore pixels exactly.');
  await driver.execute(documentId, 'history.redo', {});

  await timed('raster-gradient', () => driver.execute(documentId, 'raster.applyGradient', {
    layerId, channel: 'pixels', paint: gradient, opacity: 0.65, blendMode: 'normal'
  }));
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.redo', {});

  const commitStroke = async (name, parameters) => {
    const before = await driver.queryDocument(documentId);
    const result = await timed(name, () => driver.execute(documentId, 'tool.commitGesture', {
      kind: 'brush-stroke', parameters: { layerId, channel: 'pixels', erase: false, brush,
        ...parameters },
      samples: [{ x: 70, y: 75, pressure: 1 }, { x: 125, y: 100, pressure: 0.75 }]
    }));
    assert.equal(result.value?.kind, 'brush-stroke', `${name} was not accepted.`);
    assert.equal((await driver.queryDocument(documentId)).history.undoDepth,
      before.history.undoDepth + 1, `${name} did not create exactly one history entry.`);
  };
  await commitStroke('brush', {});
  await commitStroke('erase', { erase: true });
  for (const mode of ['dodge', 'burn', 'sponge']) {
    await commitStroke(mode, { operator: { operator: 'tone', mode, range: 'midtones',
      spongeMode: 'saturate', protectTones: true, vibrance: true } });
  }
  for (const operator of ['clone', 'healing']) {
    await commitStroke(operator, { operator: {
      operator, source: { anchorLayerId: layerId, point: { x: 60, y: 60 } },
      sampleMode: 'current', sourceOffset: { x: -25, y: -15 }, diffusion: 5
    } });
  }

  const beforeCancel = await driver.queryDocument(documentId);
  const cancelPreview = await preview();
  const gesture = await driver.beginGesture({ documentId, kind: 'brush-stroke',
    coordinateSpace: 'document', parameters: { layerId, channel: 'pixels', erase: false, brush },
    sample: { x: 60, y: 60, pressure: 1 }, pointerId: 903 });
  assert.equal(gesture.status, 'started', JSON.stringify(gesture));
  await driver.updateGesture(gesture.gestureId, [{ x: 120, y: 95, pressure: 1 }]);
  await page.waitForTimeout(50);
  await driver.finishGesture(gesture.gestureId, false);
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth, beforeCancel.history.undoDepth);
  assert.deepEqual((await preview()).data, cancelPreview.data, 'Cancelled stroke retained pixels.');

  await driver.execute(documentId, 'layer.setMask', { layerId, operation: 'add', source: 'reveal-all' });
  const beforeMask = await driver.queryDocument(documentId);
  const maskGesture = await driver.beginGesture({ documentId, kind: 'brush-stroke',
    coordinateSpace: 'document', parameters: { layerId, channel: 'mask', erase: false, brush },
    sample: { x: 75, y: 70, pressure: 1 }, pointerId: 904 });
  await driver.updateGesture(maskGesture.gestureId, [{ x: 130, y: 105, pressure: 1 }]);
  await driver.finishGesture(maskGesture.gestureId, true);
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth,
  { id: documentId, depth: beforeMask.history.undoDepth + 1 }, { timeout: 30_000 });
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.redo', {});

  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    documentId, timings, pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Packaged raster-paint kernel smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
