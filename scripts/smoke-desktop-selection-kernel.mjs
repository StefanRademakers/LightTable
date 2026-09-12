import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import sharp from 'sharp';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'selection-kernel-smoke');
await mkdir(output, { recursive: true });
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

const expectedBounds = { x: 20, y: 30, width: 80, height: 60 };

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await waitForDesktopLauncher({ app, page, outputDirectory: output, sourceFile: null,
    pageErrors, label: 'selection-kernel' });
  const driver = await attachLightTableAutomation(page, 'selection-kernel');
  const created = await driver.executeWorkspace('document.create', {
    name: 'Selection kernel primary', width: 256, height: 192, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'solid', color: '#386aa8' }
  });
  const documentId = created.value?.documentId;
  assert.ok(documentId);
  await driver.waitForReadyDocument(documentId, 60_000);
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace', shape: { kind: 'rectangle', points: [
      { x: expectedBounds.x, y: expectedBounds.y },
      { x: expectedBounds.x + expectedBounds.width, y: expectedBounds.y + expectedBounds.height }
    ] }, featherRadius: 0, antiAlias: false
  });

  const copyBounds = async () => {
    const copied = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
    return copied.value?.bounds;
  };
  const copyPixels = async () => {
    const copied = await driver.execute(documentId, 'selection.copyPixels', { source: 'merged' });
    const artifact = await driver.readArtifact(copied.value?.artifact?.id);
    assert.ok(artifact?.bytes?.length, 'Selection copy returned no pixel artifact.');
    const image = await sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { bounds: copied.value?.bounds, image };
  };
  const originalCopy = await copyPixels();
  assert.deepEqual(originalCopy.bounds, expectedBounds);
  const assertOriginalCopy = async () => {
    const current = await copyPixels();
    assert.deepEqual(current.bounds, expectedBounds);
    assert.deepEqual(current.image.info, originalCopy.image.info);
    assert.deepEqual(current.image.data, originalCopy.image.data,
      'Selection pixels changed after an edge excursion and return.');
  };

  let pointer = 100;
  const gesture = async (kind, parameters, start, samples) => {
    const before = await driver.queryDocument(documentId);
    const begun = await driver.beginGesture({ documentId, kind, coordinateSpace: 'document',
      parameters, sample: start, pointerId: pointer++ });
    assert.equal(begun?.status, 'started', JSON.stringify(begun));
    const updated = await driver.updateGesture(begun.gestureId, samples);
    assert.equal(updated?.status, 'updated', JSON.stringify(updated));
    const finished = await driver.finishGesture(begun.gestureId, true);
    assert.equal(finished?.status, 'completed', JSON.stringify(finished));
    await page.waitForFunction(({ id, depth }) => (
      window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth
    ), { id: documentId, depth: before.history.undoDepth + 1 }, { timeout: 30_000 });
  };

  // Every excursion crosses one canvas edge, commits a small displacement,
  // then a second gesture returns to the exact opening coverage.
  const excursions = [
    [{ x: 60, y: 60 }, { x: -140, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 60 }, { x: 60, y: 60 }],
    [{ x: 60, y: 60 }, { x: 396, y: 60 }, { x: 65, y: 60 }, { x: 65, y: 60 }, { x: 60, y: 60 }],
    [{ x: 60, y: 60 }, { x: 60, y: -120 }, { x: 60, y: 55 }, { x: 60, y: 55 }, { x: 60, y: 60 }],
    [{ x: 60, y: 60 }, { x: 60, y: 300 }, { x: 60, y: 65 }, { x: 60, y: 65 }, { x: 60, y: 60 }],
  ];
  for (const [start, outside, displaced, returnStart, returned] of excursions) {
    await gesture('selection-rectangle', { mode: 'replace' }, start, [outside, displaced]);
    await gesture('selection-rectangle', { mode: 'replace' }, returnStart, [returned]);
    await assertOriginalCopy();
  }

  // History restore must retain the opening mask lineage, not the clipped GPU
  // realization produced while the selection is partly outside the canvas.
  await gesture('selection-rectangle', { mode: 'replace' },
    { x: 60, y: 60 }, [{ x: -140, y: 60 }, { x: 10, y: 60 }]);
  await driver.execute(documentId, 'history.undo');
  await driver.execute(documentId, 'history.redo');
  await gesture('selection-rectangle', { mode: 'replace' },
    { x: 20, y: 60 }, [{ x: 70, y: 60 }]);
  await assertOriginalCopy();

  // Nudge uses the same terminal translation route and must also round-trip.
  await page.keyboard.press('m');
  const beforeNudge = await driver.queryDocument(documentId);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(({ id, depth }) => (
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth >= depth
  ), { id: documentId, depth: beforeNudge.history.undoDepth + 2 }, { timeout: 30_000 });
  assert.deepEqual(await copyBounds(), expectedBounds);

  const previewRaw = async () => {
    const state = await driver.queryDocument(documentId);
    const preview = await driver.requestDocumentPreview(documentId, state.canonicalRevision, 256);
    const artifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
    assert.ok(artifact?.bytes?.length);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const beforePaint = await previewRaw();
  const activeLayerId = (await driver.queryDocument(documentId)).activeLayerId;
  assert.ok(activeLayerId);
  await gesture('brush-stroke', { layerId: activeLayerId, channel: 'pixels' },
    { x: 0, y: 60, pressure: 1 }, [{ x: 255, y: 60, pressure: 1 }]);
  const afterPaint = await previewRaw();
  let changed = 0;
  const changedColumns = new Set();
  let changedMinX = Infinity;
  let changedMaxX = -Infinity;
  for (let index = 0; index < beforePaint.data.length; index += 4) {
    if (beforePaint.data[index] === afterPaint.data[index]
      && beforePaint.data[index + 1] === afterPaint.data[index + 1]
      && beforePaint.data[index + 2] === afterPaint.data[index + 2]) continue;
    changed += 1;
    const x = (index / 4) % beforePaint.info.width;
    const y = Math.floor(index / 4 / beforePaint.info.width);
    assert.ok(x >= expectedBounds.x && x < expectedBounds.x + expectedBounds.width
      && y >= expectedBounds.y && y < expectedBounds.y + expectedBounds.height,
    `Paint escaped committed selection at ${x},${y}`);
    changedColumns.add(x);
    changedMinX = Math.min(changedMinX, x);
    changedMaxX = Math.max(changedMaxX, x);
  }
  assert.ok(changed > 0, 'Paint through the committed selection changed no pixels.');
  assert.equal(changedColumns.size, expectedBounds.width,
    'Paint did not cover every selected column.');
  assert.equal(changedMinX, expectedBounds.x);
  assert.equal(changedMaxX, expectedBounds.x + expectedBounds.width - 1);

  await gesture('selection-paint', { mode: 'add', size: 24, hardness: 1, opacity: 1, smooth: 0 },
    { x: 110, y: 60, pressure: 1 }, [{ x: 116, y: 60, pressure: 1 }]);
  const paintedBounds = await copyBounds();
  assert.ok(paintedBounds.width > expectedBounds.width);
  await driver.execute(documentId, 'history.undo');
  assert.deepEqual(await copyBounds(), expectedBounds);
  await driver.execute(documentId, 'history.redo');
  assert.deepEqual(await copyBounds(), paintedBounds);
  const paintedCopy = await copyPixels();
  await gesture('selection-rectangle', { mode: 'replace' },
    { x: 110, y: 60 }, [{ x: 113, y: 60 }]);
  await gesture('selection-rectangle', { mode: 'replace' },
    { x: 113, y: 60 }, [{ x: 110, y: 60 }]);
  const returnedPaintedCopy = await copyPixels();
  assert.deepEqual(returnedPaintedCopy.bounds, paintedCopy.bounds);
  assert.deepEqual(returnedPaintedCopy.image.data, paintedCopy.image.data,
    'Paint-only selection coverage was not draggable from its exact mask.');

  const second = await driver.executeWorkspace('document.create', {
    name: 'Selection kernel secondary', width: 64, height: 64, resolutionPpi: 72,
    bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' }
  });
  assert.ok(second.value?.documentId);
  await driver.waitForReadyDocument(second.value.documentId, 60_000);
  await page.locator('.ui-document-tabs__title', { hasText: 'Selection kernel primary' }).click();
  await page.waitForFunction((id) => {
    const state = window.__lightTableAutomation?.queryDocument(id);
    return state?.renderer.active && state.renderer.status === 'ready';
  }, documentId, { timeout: 60_000 });
  assert.deepEqual(await copyBounds(), paintedBounds);

  // Pure painted coverage has no geometric provenance. Delete must clear pixels,
  // never interpret that empty provenance as permission to delete the layer.
  await gesture('selection-paint', { mode: 'replace', size: 24, hardness: 1, opacity: 1, smooth: 0 },
    { x: 160, y: 90, pressure: 1 }, [{ x: 178, y: 90, pressure: 1 }]);
  const beforeDelete = await previewRaw();
  const deleteState = await driver.queryDocument(documentId);
  const deleteLayers = await driver.queryLayers(documentId);
  await page.keyboard.press('m');
  await page.keyboard.press('Delete');
  await page.waitForFunction(({ id, depth }) =>
    window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === depth,
  { id: documentId, depth: deleteState.history.undoDepth + 1 }, { timeout: 30_000 });
  assert.deepEqual((await driver.queryLayers(documentId)).map(layer => layer.id),
    deleteLayers.map(layer => layer.id), 'Delete removed a layer instead of painted selection pixels.');
  const afterDelete = await previewRaw();
  let clearedPixels = 0;
  for (let index = 3; index < beforeDelete.data.length; index += 4) {
    if (afterDelete.data[index] < beforeDelete.data[index]) clearedPixels++;
  }
  assert.ok(clearedPixels > 0, 'Delete did not clear painted selection pixels.');
  await driver.execute(documentId, 'history.undo');
  assert.deepEqual((await previewRaw()).data, beforeDelete.data,
    'Painted selection Delete undo must restore exact RGBA pixels.');

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Actions panel', exact: true }).click();
  const recorder = page.getByRole('complementary', { name: 'Actions' })
    .locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record', exact: true }).click();
  const canvasBox = await page.locator('.lighttable-viewport__canvas').boundingBox();
  assert.ok(canvasBox);
  const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(center.x - 35, center.y - 25);
  await page.mouse.down();
  await page.mouse.move(center.x + 25, center.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
    .some(step => step.command === 'selection.applyShape'), undefined, { timeout: 30_000 });
  await recorder.getByRole('button', { name: 'Stop', exact: true }).click();
  const recorded = await driver.queryActionRecording();
  assert.deepEqual(recorded.steps.map(step => step.command), ['selection.applyShape'],
    'A real marquee gesture must record exactly one admitted shape command.');
  const recordedCopy = await copyPixels();
  await driver.execute(documentId, 'history.undo');
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__lightTableAutomation?.actionPlaybackSnapshot?.().status === 'completed',
    undefined, { timeout: 30_000 });
  const replayedCopy = await copyPixels();
  assert.deepEqual(replayedCopy.bounds, recordedCopy.bounds);
  assert.deepEqual(replayedCopy.image.data, recordedCopy.image.data,
    'Actions replay must reproduce the real marquee selection pixels.');

  const report = { documentId, expectedBounds, paintedBounds, changedPaintPixels: changed,
    paintedSelectionDelete: { clearedPixels, layerRetained: true, exactUndo: true },
    marqueeActions: { recordedOnce: true, exactReplay: true },
    history: (await driver.queryDocument(documentId)).history, pageErrors };
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Packaged selection kernel smoke passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
}
