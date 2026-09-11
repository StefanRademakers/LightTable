import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'transform-kernel-smoke');
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
    pageErrors, label: 'transform-kernel' });
  const driver = await attachLightTableAutomation(page, 'transform-kernel');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Transform kernel', width: 1024, height: 768, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#507090' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId);
  await driver.waitForRenderedDocument(documentId, 60_000);
  const layerId = (await driver.queryLayers(documentId))[0]?.id;
  assert.ok(layerId);

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
    const point = await page.evaluate(({ x, y, width, height }) => {
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fx of [0.5, 0.65, 0.35, 0.8, 0.2]) {
          const candidate = { x: x + width * fx, y: y + height * fy };
          if (document.elementFromPoint(candidate.x, candidate.y)
            ?.classList.contains('lighttable-transform__body')) return candidate;
        }
      }
      return null;
    }, viewportBounds);
    assert.ok(point, 'No visible transform body point was available.');
    return { point, viewportBounds };
  };

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
  const movedLayer = (await driver.queryLayers(documentId)).find(({ id }) => id === layerId);
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
  const beforeHandoff = await driver.queryDocument(documentId);
  const beforeHandoffPixels = await layerPreview(pastedLayerId);
  await page.keyboard.press('Control+t');
  const { point: handoffStart } = await visibleBodyPoint();
  const handoffBody = page.locator('.lighttable-transform__body');
  await page.mouse.move(handoffStart.x, handoffStart.y);
  await page.mouse.down();
  await page.mouse.move(handoffStart.x + 72, handoffStart.y + 48, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth,
    beforeHandoff.history.undoDepth,
    'Pointer-up incorrectly committed the open transform session.');
  const effect = await driver.execute(documentId, 'layer.effect.add', {
    layerId: pastedLayerId,
    effectKind: 'drop-shadow'
  });
  assert.equal(effect.status, 'completed', JSON.stringify(effect));
  await handoffBody.waitFor({ state: 'hidden', timeout: 20_000 });
  const afterHandoff = await driver.queryDocument(documentId);
  assert.equal(afterHandoff.history.undoDepth, beforeHandoff.history.undoDepth + 2,
    `Transform and Drop Shadow must remain two ordered history entries: ${JSON.stringify({ beforeHandoff, afterHandoff })}`);
  assert.equal(afterHandoff.history.undoLabel, 'Layer Style');
  const afterHandoffPixels = await layerPreview(pastedLayerId);
  assert.notDeepEqual(afterHandoffPixels.data, beforeHandoffPixels.data,
    'The semantic command revived the selected-pixel transform opening state.');
  const rasterizeButton = page.locator(
    `[data-layer-id="${pastedLayerId}"] .lighttable-layer__rasterize`
  );
  await rasterizeButton.waitFor({ state: 'visible', timeout: 20_000 });
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, afterHandoffPixels.data,
    'Undoing Drop Shadow also rolled back the preceding transform checkpoint.');
  await driver.execute(documentId, 'history.undo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, beforeHandoffPixels.data,
    'Undoing the settled transform did not restore the exact pasted pixels.');
  await driver.execute(documentId, 'history.redo', {});
  await driver.execute(documentId, 'history.redo', {});
  assert.deepEqual((await layerPreview(pastedLayerId)).data, afterHandoffPixels.data,
    'Redo did not restore the exact transformed pixels after the effect handoff.');

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
    documentId, timings, movedTransform: movedLayer.transform, pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Packaged transform kernel smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
