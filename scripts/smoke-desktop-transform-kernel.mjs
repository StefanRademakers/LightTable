import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = process.env.LIGHTTABLE_TRANSFORM_OUTPUT
  ? path.resolve(process.env.LIGHTTABLE_TRANSFORM_OUTPUT)
  : path.join(root, 'tmp', 'transform-kernel-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
const sourceFile = process.env.LIGHTTABLE_TRANSFORM_SOURCE
  ? path.resolve(process.env.LIGHTTABLE_TRANSFORM_SOURCE)
  : null;
const keyboardTransformGesture = process.env.LIGHTTABLE_TRANSFORM_GESTURE ?? 'translate';
assert.ok(['translate', 'scale', 'rotate'].includes(keyboardTransformGesture),
  `Unsupported LIGHTTABLE_TRANSFORM_GESTURE: ${keyboardTransformGesture}`);
const keyboardSelectionShape = process.env.LIGHTTABLE_SELECTION_SHAPE ?? 'rectangle';
assert.ok(['rectangle', 'free'].includes(keyboardSelectionShape),
  `Unsupported LIGHTTABLE_SELECTION_SHAPE: ${keyboardSelectionShape}`);
const handoffOnly = process.env.LIGHTTABLE_TRANSFORM_HANDOFF_ONLY === '1';
if (sourceFile) environment.LIGHTTABLE_AUTOMATION_OPEN_FILE = sourceFile;
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
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile,
    pageErrors, label: 'transform-kernel' });
  if (sourceFile) {
    await openFile.click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
  }
  const driver = await attachLightTableAutomation(page, 'transform-kernel');
  const created = sourceFile ? null : await driver.executeWorkspace('document.create', {
      name: 'Transform kernel', width: 1024, height: 768, resolutionPpi: 72,
      bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#507090' }
    });
  const documentId = sourceFile
    ? (await driver.queryWorkspace()).activeDocumentId
    : created?.value?.documentId;
  assert.ok(documentId);
  await driver.waitForReadyDocument(documentId, 60_000);
  const openingLayers = await driver.queryLayers(documentId);
  const sourceLayerName = process.env.LIGHTTABLE_TRANSFORM_SOURCE_LAYER;
  const layerId = (sourceLayerName
    ? openingLayers.find((layer) => layer.name === sourceLayerName)
    : openingLayers[0])?.id;
  assert.ok(layerId);
  if (sourceLayerName) {
    await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
  }

  const viewport = page.locator('.lighttable-viewport');
  const layerPreview = async (targetLayerId) => {
    const state = await driver.queryDocument(documentId);
    const request = await page.evaluate((parameters) =>
      window.__lightTableAutomation?.requestLayerPreview(parameters) ?? null, {
      documentId, layerId: targetLayerId, channel: 'pixels',
      expectedDocumentRevision: state.canonicalRevision, maxEdge: 512
    });
    assert.equal(request?.status, 'completed', JSON.stringify(request));
    const artifact = await driver.readArtifact(request?.artifact?.id ?? request?.id);
    assert.ok(artifact?.bytes?.length);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const visiblePixelCount = (preview) => {
    let count = 0;
    for (let index = 3; index < preview.data.length; index += 4) {
      if (preview.data[index] > 0) count += 1;
    }
    return count;
  };
  const documentPreview = async () => {
    const state = await driver.queryDocument(documentId);
    const request = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 512);
    const artifact = await driver.readArtifact(request?.artifact?.id ?? request?.id);
    assert.ok(artifact?.bytes?.length);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const visibleBodyPoint = async () => {
    const body = page.locator('.lighttable-transform__body');
    try {
      await body.waitFor({ state: 'visible', timeout: 20_000 });
    } catch (reason) {
      const diagnostics = {
        document: await driver.queryDocument(documentId).catch(() => null),
        bodyText: await page.locator('body').innerText().catch(() => ''),
        pageErrors
      };
      await writeFile(path.join(output, 'failure.json'), `${JSON.stringify(diagnostics, null, 2)}\n`);
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
      throw new Error(`Transform controls did not appear: ${JSON.stringify(diagnostics)}`, {
        cause: reason
      });
    }
    const viewportBounds = await viewport.boundingBox();
    assert.ok(viewportBounds);
    const bodyBounds = await body.boundingBox();
    assert.ok(bodyBounds);
    const point = await page.evaluate(({ bodyBounds, viewportBounds }) => {
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fx of [0.5, 0.65, 0.35, 0.8, 0.2]) {
          const candidate = {
            x: bodyBounds.x + bodyBounds.width * fx,
            y: bodyBounds.y + bodyBounds.height * fy
          };
          if (document.elementFromPoint(candidate.x, candidate.y)
            ?.classList.contains('lighttable-transform__body')) return candidate;
        }
      }
      const { x, y, width, height } = viewportBounds;
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fx of [0.5, 0.65, 0.35, 0.8, 0.2]) {
          const candidate = { x: x + width * fx, y: y + height * fy };
          if (document.elementFromPoint(candidate.x, candidate.y)
            ?.classList.contains('lighttable-transform__body')) return candidate;
        }
      }
      return null;
    }, { bodyBounds, viewportBounds });
    assert.ok(point, 'No visible transform body point was available.');
    return { point, viewportBounds };
  };

  let movedLayer;
  if (!handoffOnly) {
  await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 250 });
  await page.keyboard.press('v');
  const beforeGeometry = await driver.queryDocument(documentId);
  const { point: start, viewportBounds } = await visibleBodyPoint();
  const edge = {
    x: viewportBounds.x + viewportBounds.width - 3,
    y: Math.min(viewportBounds.y + viewportBounds.height - 40, start.y + 18)
  };
  await timed('geometry-drag-with-edge-pan', async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y, { steps: 8 });
    await page.waitForTimeout(280);
    await page.mouse.up();
    await page.keyboard.press('Enter');
  });
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth,
  { id: documentId, depth: beforeGeometry.history.undoDepth + 1 }, { timeout: 20_000 });
  movedLayer = (await driver.queryLayers(documentId)).find(({ id }) => id === layerId);
  assert.ok(movedLayer);
  assert.ok(Math.abs(movedLayer.transform.tx) + Math.abs(movedLayer.transform.ty) > 1,
    'The edge-pan drag did not commit layer geometry.');
  await driver.execute(documentId, 'history.undo', {});
  const restoredLayer = (await driver.queryLayers(documentId)).find(({ id }) => id === layerId);
  assert.deepEqual(restoredLayer?.transform,
    { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 'Geometry undo was not exact.');
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await driver.queryLayers(documentId)).find(({ id }) => id === layerId)?.transform,
    movedLayer.transform, 'Geometry redo was not exact.');
  await driver.execute(documentId, 'history.undo', {});

  }
  // Exact artist route: keyboard-copy a region from an image layer, keyboard-
  // paste the tight raster, transform it while the selection remains active,
  // and immediately drag Local Grade Exposure.
  await driver.execute(documentId, 'view.setZoom', { mode: 'fit' });
  // Establish an inactive transform before the explicit Ctrl+T entry below.
  // Paste while Transform is selected already opens its cage; Ctrl+T then
  // correctly commits that active transform instead of opening another one.
  await page.keyboard.press('b');
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: keyboardSelectionShape === 'free'
      ? { kind: 'free', points: [
          { x: 180, y: 250 }, { x: 235, y: 155 }, { x: 410, y: 120 },
          { x: 605, y: 220 }, { x: 570, y: 440 }, { x: 360, y: 515 },
          { x: 205, y: 420 }, { x: 180, y: 250 }
        ] }
      : { kind: 'rectangle', points: [{ x: 180, y: 140 }, { x: 620, y: 500 }] },
    featherRadius: 0, antiAlias: false
  });
  const beforeKeyboardPasteLayers = await driver.queryLayers(documentId);
  const beforeKeyboardPasteIds = new Set(beforeKeyboardPasteLayers.map(({ id }) => id));
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  let keyboardPastedLayer = null;
  for (let attempt = 0; attempt < 40 && !keyboardPastedLayer; attempt += 1) {
    keyboardPastedLayer = (await driver.queryLayers(documentId))
      .find(({ id }) => !beforeKeyboardPasteIds.has(id)) ?? null;
    if (!keyboardPastedLayer) await page.waitForTimeout(100);
  }
  assert.ok(keyboardPastedLayer, 'Keyboard Paste did not create a layer.');
  const keyboardPastedLayerId = keyboardPastedLayer.id;
  const beforeKeyboardTransformPixels = await layerPreview(keyboardPastedLayerId);
  assert.ok(visiblePixelCount(beforeKeyboardTransformPixels) > 0,
    'Keyboard Paste created an empty layer before transform.');
  // The first slider change must create Grade itself. Pre-creating it here
  // bypasses the user's failing first-adjustment path.
  const keyboardExposureSlider = page.getByRole('slider', { name: 'Exposure' }).first();
  await keyboardExposureSlider.waitFor({ state: 'visible', timeout: 20_000 });
  const beforeKeyboardHandoff = await driver.queryDocument(documentId);
  assert.equal(await page.locator('.lighttable-transform__body').count(), 0,
    'The keyboard-entry fixture must begin outside Transform.');
  await page.keyboard.press('Control+t');
  const keyboardTransformBody = page.locator('.lighttable-transform__body');
  const { point: keyboardTransformStart } = await visibleBodyPoint();
  // Move completely away from the original tight pasted surface before the
  // second gesture. Overlapping the original surface can conceal clipping.
  if (keyboardTransformGesture !== 'translate') {
    await page.mouse.move(keyboardTransformStart.x, keyboardTransformStart.y);
    await page.mouse.down();
    await page.mouse.move(keyboardTransformStart.x + 250, keyboardTransformStart.y + 180, { steps: 10 });
    await page.mouse.up();
  }
  const gestureTarget = keyboardTransformGesture === 'scale'
    ? page.locator('.lighttable-transform > rect').nth(4)
    : keyboardTransformGesture === 'rotate'
      ? page.locator('.lighttable-transform__corner-rotation-target').first()
      : keyboardTransformBody;
  const gestureBounds = await gestureTarget.boundingBox();
  assert.ok(gestureBounds, `${keyboardTransformGesture} transform target was not visible.`);
  const gestureStart = keyboardTransformGesture === 'translate'
    ? keyboardTransformStart
    : { x: gestureBounds.x + gestureBounds.width / 2, y: gestureBounds.y + gestureBounds.height / 2 };
  const gestureEnd = keyboardTransformGesture === 'rotate'
    ? { x: gestureStart.x + 76, y: gestureStart.y + 34 }
    : { x: gestureStart.x + 68, y: gestureStart.y + 42 };
  await page.mouse.move(gestureStart.x, gestureStart.y);
  await page.mouse.down();
  await page.mouse.move(gestureEnd.x, gestureEnd.y, { steps: 10 });
  await page.mouse.up();
  const keyboardExposureBounds = await keyboardExposureSlider.boundingBox();
  assert.ok(keyboardExposureBounds);
  if (process.env.LIGHTTABLE_TRANSFORM_SLOW_READBACK === '1') {
    await page.evaluate(() => {
      const original = GPUBuffer.prototype.mapAsync;
      GPUBuffer.prototype.mapAsync = async function (...args) {
        await original.apply(this, args);
        await new Promise((resolve) => setTimeout(resolve, 100));
      };
    });
  }
  await keyboardExposureSlider.evaluate((element) => {
    window.__lightTableTransformExposureLatency = {
      pointerDownAt: null,
      firstMoveAt: null,
      firstInputAt: null,
      transformHiddenAt: null
    };
    element.addEventListener('pointerdown', () => {
      const probe = window.__lightTableTransformExposureLatency;
      if (!probe) return;
      probe.pointerDownAt = performance.now();
      const openingValue = element.value;
      const observeTransformSettlement = () => {
        if (probe.firstInputAt === null && element.value !== openingValue) {
          probe.firstInputAt = performance.now();
        }
        if (!document.querySelector('.lighttable-transform__body')) {
          probe.transformHiddenAt = performance.now();
        }
        if (probe.firstInputAt === null || probe.transformHiddenAt === null) {
          requestAnimationFrame(observeTransformSettlement);
        }
      };
      requestAnimationFrame(observeTransformSettlement);
    }, { capture: true, once: true });
    element.addEventListener('pointermove', () => {
      const probe = window.__lightTableTransformExposureLatency;
      if (probe && probe.pointerDownAt !== null && probe.firstMoveAt === null) {
        probe.firstMoveAt = performance.now();
      }
    }, { capture: true });
  });
  const keyboardHandoffStartedAt = performance.now();
  await page.mouse.move(
    keyboardExposureBounds.x + keyboardExposureBounds.width * 0.5,
    keyboardExposureBounds.y + keyboardExposureBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    keyboardExposureBounds.x + keyboardExposureBounds.width * 0.62,
    keyboardExposureBounds.y + keyboardExposureBounds.height / 2,
    { steps: 3 }
  );
  const keyboardLocalFeedbackDurationMs = performance.now() - keyboardHandoffStartedAt;
  assert.ok(Number(await keyboardExposureSlider.inputValue()) > 0.5,
    'Exposure did not provide immediate local slider feedback while transform publication was admitting the gesture.');
  await keyboardTransformBody.waitFor({ state: 'hidden', timeout: 20_000 });
  const keyboardTransformSettlementDurationMs = performance.now() - keyboardHandoffStartedAt;
  const browserLatency = await page.evaluate(() => window.__lightTableTransformExposureLatency);
  assert.ok(browserLatency?.pointerDownAt !== null && browserLatency?.firstMoveAt !== null
    && browserLatency?.firstInputAt !== null
    && browserLatency?.transformHiddenAt !== null,
  'The browser did not observe the complete transform-to-Exposure latency boundary.');
  const browserLocalFeedbackDurationMs = browserLatency.firstInputAt - browserLatency.firstMoveAt;
  const browserTransformSettlementDurationMs = browserLatency.transformHiddenAt
    - browserLatency.pointerDownAt;
  await page.waitForTimeout(Math.max(0, 150 - keyboardTransformSettlementDurationMs));
  assert.ok(Number(await keyboardExposureSlider.inputValue()) > 0.5,
    'Exposure local feedback snapped back while transform publication was admitting the gesture.');
  await page.mouse.move(
    keyboardExposureBounds.x + keyboardExposureBounds.width * 0.72,
    keyboardExposureBounds.y + keyboardExposureBounds.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();
  try {
    await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation
      ?.queryDocument(id)?.history.undoDepth === depth + 2, {
      id: documentId, depth: beforeKeyboardHandoff.history.undoDepth
    }, { timeout: 20_000 });
  } catch (reason) {
    const diagnostics = {
      gesture: keyboardTransformGesture,
      before: beforeKeyboardHandoff,
      after: await driver.queryDocument(documentId).catch(() => null),
      layers: await driver.queryLayers(documentId).catch(() => null),
      transformVisible: await keyboardTransformBody.isVisible().catch(() => null),
      pageErrors
    };
    await writeFile(path.join(output, `keyboard-${keyboardTransformGesture}-failure.json`),
      `${JSON.stringify(diagnostics, null, 2)}\n`);
    throw new Error(`Keyboard ${keyboardTransformGesture} handoff did not publish two checkpoints: ${JSON.stringify(diagnostics)}`, {
      cause: reason
    });
  }
  const keyboardAdmissionDurationMs = performance.now() - keyboardHandoffStartedAt;
  const afterKeyboardHandoffPixels = await layerPreview(keyboardPastedLayerId);
  assert.ok(visiblePixelCount(afterKeyboardHandoffPixels) > 0,
    'Keyboard-copied content became empty after transform-to-Exposure handoff.');
  const copySelectionPixels = async () => {
    const copy = await driver.execute(documentId, 'selection.copyPixels', { source: 'active-layer' });
    const artifact = await driver.readArtifact(copy.value?.artifact?.id);
    assert.ok(artifact?.bytes?.length, 'Transformed selection copy returned no artifact.');
    const image = await sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { bounds: copy.value.bounds, image };
  };
  const gradedSelectionCopy = await copySelectionPixels();
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  assert.ok(visiblePixelCount(await layerPreview(keyboardPastedLayerId)) > 0,
    'Keyboard-copied content became empty after leaving Transform.');
  const keyboardHandoffDurationMs = performance.now() - keyboardHandoffStartedAt;
  // Exact byte-level history proof, including the tight/document-sized surface
  // exchange. Non-empty alone cannot detect partial clipping or stale pixels.
  await driver.execute(documentId, 'history.undo', {});
  const keyboardTransformedPixels = await layerPreview(keyboardPastedLayerId);
  assert.ok(visiblePixelCount(keyboardTransformedPixels) > 0);
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(keyboardPastedLayerId)).data, beforeKeyboardTransformPixels.data,
    'Transform undo did not restore the exact keyboard-pasted pixels.');
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(keyboardPastedLayerId)).data, keyboardTransformedPixels.data,
    'Transform redo did not restore the exact transformed pixels.');
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(keyboardPastedLayerId)).data, afterKeyboardHandoffPixels.data,
    'Grade redo did not restore the exact graded pixels.');
  assert.deepEqual(await copySelectionPixels(), gradedSelectionCopy,
    'Undo/redo did not restore the exact transformed selection mask and copy area.');
  assert.deepEqual(pageErrors, [], 'The handoff emitted browser errors.');
  if (handoffOnly) {
    const variant = `${keyboardSelectionShape}-${keyboardTransformGesture}-${process.env.LIGHTTABLE_TRANSFORM_SLOW_READBACK === '1' ? 'slow' : 'normal'}`;
    await page.screenshot({ path: path.join(output, `handoff-${variant}.png`) });
    await writeFile(path.join(output, `handoff-${variant}.json`), `${JSON.stringify({
      documentId,
      gesture: keyboardTransformGesture,
      selectionShape: keyboardSelectionShape,
      localFeedbackDurationMs: keyboardLocalFeedbackDurationMs,
      transformSettlementDurationMs: keyboardTransformSettlementDurationMs,
      browserLocalFeedbackDurationMs,
      browserTransformSettlementDurationMs,
      transactionCommitDurationMs: keyboardAdmissionDurationMs,
      handoffDurationMs: keyboardHandoffDurationMs,
      visiblePixelsBefore: visiblePixelCount(beforeKeyboardTransformPixels),
      visiblePixelsAfter: visiblePixelCount(afterKeyboardHandoffPixels),
      exactUndoRedo: true,
      pageErrors
    }, null, 2)}\n`);
    process.stdout.write('Transform-to-Exposure stability smoke passed.\n');
    await app.close();
    app = undefined;
    process.exit(0);
  }
  await driver.execute(documentId, 'layer.delete', { layerIds: [keyboardPastedLayerId] });
  await driver.execute(documentId, 'selection.modify', { kind: 'modify', operation: 'clear' });

  await driver.execute(documentId, 'view.setZoom', { mode: '100' });
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  const createdRaster = await driver.execute(documentId, 'layer.createRaster', {});
  const pixelLayerId = createdRaster.value?.layerId;
  assert.ok(pixelLayerId);
  await page.waitForTimeout(100);
  const paintResult = await driver.execute(documentId, 'tool.commitGesture', {
    kind: 'brush-stroke',
    parameters: {
      layerId: pixelLayerId, channel: 'pixels', erase: false,
      brush: { presetId: 'round', size: 96, hardness: 1, opacity: 1, flow: 1,
        spacing: 0.1, smooth: 0, color: '#f02020', backgroundColor: '#ffffff' }
    },
    samples: [{ x: 290, y: 250, pressure: 1 }, { x: 390, y: 330, pressure: 1 }]
  });
  assert.equal(paintResult.value?.kind, 'brush-stroke', JSON.stringify(paintResult));
  const paintedPixelPreview = await layerPreview(pixelLayerId);
  assert.ok(paintedPixelPreview.data.some((value, index) => index % 4 === 3 && value > 0),
    'Brush fixture did not create any source pixels.');
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 220, y: 180 }, { x: 520, y: 430 }] },
    featherRadius: 0, antiAlias: false
  });
  const beforePixels = await driver.queryDocument(documentId);
  const beforePixelPreview = await layerPreview(pixelLayerId);
  const beforeDocumentPreview = await documentPreview();
  assert.ok(beforeDocumentPreview.data.some((value, index, data) =>
    index % 4 === 0 && value > 180 && data[index + 1] < 80 && data[index + 2] < 80),
  'Painted transform fixture is not visible in the document composite.');
  await page.keyboard.press('Control+t');
  const { point: pixelStart } = await visibleBodyPoint();
  const transformBody = page.locator('.lighttable-transform__body');
  const beforeDragBounds = await transformBody.boundingBox();
  assert.ok(beforeDragBounds);
  await timed('selected-pixel-drag', async () => {
    await page.mouse.move(pixelStart.x, pixelStart.y);
    await page.mouse.down();
    await page.mouse.move(pixelStart.x + 120, pixelStart.y + 80, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const checkpointBounds = await transformBody.boundingBox();
    assert.ok(checkpointBounds);
    assert.ok(Math.abs(checkpointBounds.x - beforeDragBounds.x) > 20
      || Math.abs(checkpointBounds.y - beforeDragBounds.y) > 20,
    'Selected-pixel transform checkpoint did not retain the pointer drag.');
    await page.keyboard.press('Enter');
    await transformBody.waitFor({ state: 'hidden', timeout: 20_000 });
  });
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth,
  { id: documentId, depth: beforePixels.history.undoDepth + 1 }, { timeout: 20_000 });
  const committedTransformState = await driver.queryDocument(documentId);
  assert.equal(committedTransformState.history.undoDepth,
    beforePixels.history.undoDepth + 1, 'Transform must create exactly one history entry.');
  assert.equal(committedTransformState.history.undoLabel, 'Free Transform',
    `Unexpected history owner: ${JSON.stringify(committedTransformState.history)}`);
  assert.ok(committedTransformState.canonicalRevision > beforePixels.canonicalRevision,
    `Transform did not publish a new canonical revision: ${JSON.stringify({ beforePixels, committedTransformState })}`);
  const committedPixelLayer = (await driver.queryLayers(documentId)).find(({ id }) => id === pixelLayerId);
  assert.deepEqual(committedPixelLayer?.transform, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    `Selected-pixel transform incorrectly committed layer geometry: ${JSON.stringify(committedPixelLayer)}`);
  const afterPixelPreview = await layerPreview(pixelLayerId);
  const afterDocumentPreview = await documentPreview();
  assert.notDeepEqual(afterDocumentPreview.data, beforeDocumentPreview.data,
    'Selected-pixel transform did not change the document composite.');
  assert.notDeepEqual(afterPixelPreview.data, beforePixelPreview.data,
    'Selected-pixel transform did not change the rendered pixels.');
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(pixelLayerId)).data, beforePixelPreview.data,
    'Selected-pixel undo did not restore exact pixels.');
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(pixelLayerId)).data, afterPixelPreview.data,
    'Selected-pixel redo did not restore exact pixels.');

  // Regression: a pointer-up is only a transform checkpoint. Starting a new
  // semantic command must publish that checkpoint before the command reads
  // canonical state; it must never revive the transform's opening pixels.
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 180, y: 140 }, { x: 620, y: 500 }] },
    featherRadius: 0, antiAlias: false
  });
  const copied = await driver.execute(documentId, 'selection.copyPixels', {
    source: 'active-layer'
  });
  const clipboardArtifactId = copied.value?.artifact?.id;
  assert.equal(typeof clipboardArtifactId, 'string', JSON.stringify(copied));
  const pasted = await driver.execute(documentId, 'selection.pastePixels', {
    artifactId: clipboardArtifactId,
    bounds: copied.value.bounds,
    name: 'Transform handoff selection'
  });
  const pastedLayerId = pasted.value?.layerId;
  assert.equal(typeof pastedLayerId, 'string', JSON.stringify(pasted));
  const localGrade = await driver.execute(documentId, 'adjustment.create', {
    kind: 'grade', placement: 'local', layerId: pastedLayerId
  });
  assert.equal(localGrade.status, 'completed', JSON.stringify(localGrade));
  const exposureSlider = page.getByRole('slider', { name: 'Exposure' }).first();
  await exposureSlider.waitFor({ state: 'visible', timeout: 20_000 });
  const beforeHandoff = await driver.queryDocument(documentId);
  const beforeHandoffPixels = await layerPreview(pastedLayerId);
  const beforeHandoffVisiblePixels = visiblePixelCount(beforeHandoffPixels);
  assert.ok(beforeHandoffVisiblePixels > 0,
    'The pasted transform handoff fixture contains no visible pixels before transform.');
  await page.keyboard.press('Control+t');
  const { point: handoffStart } = await visibleBodyPoint();
  const handoffBody = page.locator('.lighttable-transform__body');
  await page.mouse.move(handoffStart.x, handoffStart.y);
  await page.mouse.down();
  await page.mouse.move(handoffStart.x + 72, handoffStart.y + 48, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const checkpointBoundsBeforeBlur = await handoffBody.boundingBox();
  assert.ok(checkpointBoundsBeforeBlur, 'Transform checkpoint disappeared before focus loss.');
  const exposureBounds = await exposureSlider.boundingBox();
  assert.ok(exposureBounds, 'Exposure slider disappeared before transform settlement.');
  await exposureSlider.evaluate((element, id) => {
    window.__lightTableExposureAdmissionProbe = null;
    element.addEventListener('pointerdown', () => {
      window.__lightTableExposureAdmissionProbe = window.__lightTableAutomation
        ?.queryDocument(id)?.renderer?.active ?? null;
    }, { capture: true, once: true });
  }, documentId);
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth,
    beforeHandoff.history.undoDepth,
    'Pointer-up incorrectly committed the open transform session.');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
    window?.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0];
    const focusProbe = new BrowserWindow({ width: 160, height: 120, show: false });
    globalThis.__lightTableTransformOwner = owner;
    globalThis.__lightTableTransformFocusProbe = focusProbe;
    await focusProbe.loadURL('about:blank');
    focusProbe.show();
    focusProbe.focus();
    owner?.blur();
  });
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === false, documentId);
  assert.equal(await page.getByText('Loading image and WebGPU pipeline...').isVisible(), false,
    'Focus loss hid a resident canvas behind the document-loading placeholder.');
  const checkpointBoundsWhileBlurred = await handoffBody.boundingBox();
  assert.ok(checkpointBoundsWhileBlurred
    && Math.abs(checkpointBoundsWhileBlurred.x - checkpointBoundsBeforeBlur.x) < 1
    && Math.abs(checkpointBoundsWhileBlurred.y - checkpointBoundsBeforeBlur.y) < 1,
  'Focus loss did not retain the open transform controls at their checkpoint.');
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth,
    beforeHandoff.history.undoDepth,
    'Focus loss incorrectly committed the open transform session.');
  await app.evaluate(async ({ BrowserWindow }) => {
    const focusProbe = globalThis.__lightTableTransformFocusProbe;
    const window = globalThis.__lightTableTransformOwner
      ?? BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    window?.show();
    window?.focus();
    window?.webContents.focus();
    if (focusProbe && !focusProbe.isDestroyed()) focusProbe.close();
    globalThis.__lightTableTransformFocusProbe = undefined;
    globalThis.__lightTableTransformOwner = undefined;
  });
  // Do not wait for React to project focus into renderer activity. This first
  // click must both restore host focus and request adjustment admission, which
  // is the real user race after working in another window.
  const transformExposureStartedAt = performance.now();
  await page.mouse.move(
    exposureBounds.x + exposureBounds.width * 0.5,
    exposureBounds.y + exposureBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    exposureBounds.x + exposureBounds.width * 0.7,
    exposureBounds.y + exposureBounds.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();
  const rendererActiveAtExposurePointerDown = await page.evaluate(
    () => window.__lightTableExposureAdmissionProbe
  );
  assert.equal(typeof rendererActiveAtExposurePointerDown, 'boolean',
    'The immediate-refocus Exposure pointer-down boundary was not observed.');
  await page.waitForFunction(() => document.hasFocus());
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === true, documentId);
  await handoffBody.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation
    ?.queryDocument(id)?.history.undoDepth === depth + 2, {
    id: documentId, depth: beforeHandoff.history.undoDepth
  }, { timeout: 20_000 });
  timings.push({
    operation: 'transform-to-exposure-admission',
    durationMs: performance.now() - transformExposureStartedAt
  });
  const afterHandoff = await driver.queryDocument(documentId);
  assert.equal(afterHandoff.history.undoDepth, beforeHandoff.history.undoDepth + 2,
    `Transform and Local Grade must remain two ordered history entries: ${JSON.stringify({ beforeHandoff, afterHandoff })}`);
  assert.equal(afterHandoff.history.undoLabel, 'Edit Adjustment Layer');
  const afterHandoffPixels = await layerPreview(pastedLayerId);
  assert.ok(visiblePixelCount(afterHandoffPixels) > 0,
    'The pasted layer became empty after transform-to-Exposure handoff.');
  assert.notDeepEqual(afterHandoffPixels.data, beforeHandoffPixels.data,
    'The Exposure gesture revived the selected-pixel transform opening state.');
  await app.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0];
    const focusProbe = new BrowserWindow({ width: 160, height: 120, show: false });
    globalThis.__lightTableTransformOwner = owner;
    globalThis.__lightTableTransformFocusProbe = focusProbe;
    await focusProbe.loadURL('about:blank');
    focusProbe.show();
    focusProbe.focus();
    owner?.blur();
  });
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === false, documentId);
  assert.equal(await page.getByText('Loading image and WebGPU pipeline...').isVisible(), false,
    'Post-Grade focus loss hid a resident canvas behind the document-loading placeholder.');
  await app.evaluate(async ({ BrowserWindow }) => {
    const focusProbe = globalThis.__lightTableTransformFocusProbe;
    if (focusProbe && !focusProbe.isDestroyed()) focusProbe.close();
    globalThis.__lightTableTransformFocusProbe = undefined;
    const window = globalThis.__lightTableTransformOwner
      ?? BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    globalThis.__lightTableTransformOwner = undefined;
    window?.show();
    await new Promise((resolve) => setTimeout(resolve, 100));
    window?.focus();
    window?.webContents.focus();
  });
  await page.waitForFunction(() => document.hasFocus());
  await page.waitForFunction((id) => window.__lightTableAutomation
    ?.queryDocument(id)?.renderer?.active === true, documentId);
  const afterHandoffRefocusPixels = await layerPreview(pastedLayerId);
  assert.ok(visiblePixelCount(afterHandoffRefocusPixels) > 0,
    'The transformed pasted layer became empty after Grade and a presentation rebind.');
  assert.deepEqual(afterHandoffRefocusPixels.data, afterHandoffPixels.data,
    'Presentation rebind changed the transformed pasted-layer pixels after Grade.');
  const rasterizeButton = page.locator(
    `[data-layer-id="${pastedLayerId}"] .lighttable-layer__rasterize`
  );
  await rasterizeButton.waitFor({ state: 'visible', timeout: 20_000 });
  await driver.execute(documentId, 'history.undo', {});
  const transformedWithoutGrade = await layerPreview(pastedLayerId);
  assert.ok(visiblePixelCount(transformedWithoutGrade) > 0,
    'Undoing Exposure exposed an empty transformed pasted layer.');
  assert.notDeepEqual(transformedWithoutGrade.data, beforeHandoffPixels.data,
    'Undoing Exposure also rolled back the preceding transform checkpoint.');
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, beforeHandoffPixels.data,
    'Undoing the settled transform did not restore the exact pasted pixels.');
  await driver.execute(documentId, 'history.redo', {});
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, afterHandoffPixels.data,
    'Redo did not restore the exact transformed pixels after the Grade handoff.');

  // A reset is a discrete adjustment mutation, not part of the slider's
  // continuous gesture. It must use the same transition gate and may not race
  // an open selected-pixel transform.
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1024, y: 768 }] },
    featherRadius: 0, antiAlias: false
  });
  const beforeResetHandoff = await driver.queryDocument(documentId);
  const beforeResetHandoffPixels = await layerPreview(pastedLayerId);
  await page.keyboard.press('Control+t');
  const { point: resetHandoffStart } = await visibleBodyPoint();
  await page.mouse.move(resetHandoffStart.x, resetHandoffStart.y);
  await page.mouse.down();
  await page.mouse.move(resetHandoffStart.x - 46, resetHandoffStart.y + 34, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const exposureResetLabel = exposureSlider.locator('xpath=../..').locator('.ui-slider__label');
  assert.equal(await exposureResetLabel.textContent(), 'Exposure');
  await exposureResetLabel.dblclick();
  await handoffBody.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation
    ?.queryDocument(id)?.history.undoDepth === depth + 2, {
    id: documentId, depth: beforeResetHandoff.history.undoDepth
  }, { timeout: 20_000 });
  const afterResetHandoff = await driver.queryDocument(documentId);
  assert.equal(afterResetHandoff.history.undoLabel, 'Edit Adjustment Layer',
    `Discrete Exposure reset did not own the terminal checkpoint: ${JSON.stringify(afterResetHandoff.history)}`);
  const afterResetHandoffPixels = await layerPreview(pastedLayerId);
  assert.notDeepEqual(afterResetHandoffPixels.data, beforeResetHandoffPixels.data,
    'The discrete Exposure reset revived the transform opening pixels.');
  await driver.execute(documentId, 'history.undo', {});
  assert.notDeepEqual((await layerPreview(pastedLayerId)).data, beforeResetHandoffPixels.data,
    'Undoing the discrete Exposure reset also rolled back the transform.');
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, beforeResetHandoffPixels.data,
    'Undoing the transform before the discrete reset did not restore exact pixels.');
  await driver.execute(documentId, 'history.redo', {});
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, afterResetHandoffPixels.data,
    'Redo did not restore transform plus discrete Exposure reset exactly.');

  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
  const groupCandidates = (await driver.queryLayers(documentId))
    .filter(({ parentId, visible }) => parentId === null && visible).slice(0, 2);
  assert.equal(groupCandidates.length, 2, 'Generated fixture needs two visible root layers.');
  await page.locator(`[data-layer-id="${groupCandidates[0].id}"]`).click();
  await page.locator(`[data-layer-id="${groupCandidates[1].id}"]`).click({ modifiers: ['Control'] });
  await page.waitForTimeout(150);
  const beforeGroup = await driver.queryDocument(documentId);
  const beforeGroupLayers = await driver.queryLayers(documentId);
  const { point: groupStart } = await visibleBodyPoint();
  await timed('multi-layer-drag', async () => {
    await page.mouse.move(groupStart.x, groupStart.y);
    await page.mouse.down();
    await page.mouse.move(groupStart.x + 54, groupStart.y + 37, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
  });
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
  { id: documentId, depth: beforeGroup.history.undoDepth + 1 }, { timeout: 20_000 });
  const afterGroup = await driver.queryDocument(documentId);
  assert.ok(afterGroup.canonicalRevision > beforeGroup.canonicalRevision,
    'Multi-layer transform was not published to canonical observers.');
  const afterGroupLayers = await driver.queryLayers(documentId);
  const deltas = groupCandidates.map(({ id }) => {
    const before = beforeGroupLayers.find((layer) => layer.id === id)?.transform;
    const after = afterGroupLayers.find((layer) => layer.id === id)?.transform;
    assert.ok(before && after);
    return { x: after.tx - before.tx, y: after.ty - before.ty };
  });
  assert.ok(Math.hypot(deltas[0].x, deltas[0].y) > 10, 'Multi-layer drag did not move.');
  assert.ok(Math.abs(deltas[0].x - deltas[1].x) < 1e-5
    && Math.abs(deltas[0].y - deltas[1].y) < 1e-5,
  `Multi-layer members did not retain one document-space delta: ${JSON.stringify(deltas)}`);

  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    documentId,
    timings,
    movedTransform: movedLayer.transform,
    rendererActiveAtExposurePointerDown,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Packaged transform kernel smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
