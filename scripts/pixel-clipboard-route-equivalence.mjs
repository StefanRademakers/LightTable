import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mcpResult } from './action-route-equivalence.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

const strictRenderPolicy = {
  maximumRmse: 0, maximumMeanAbsoluteError: 0,
  maximumChannelRmse: 0, maximumChannelMeanAbsoluteError: 0,
  maximumP95PixelDelta: 0, maximumChangedPixelRatioAt16: 0
};

const writePreview = async (driver, documentId, target) => {
  await driver.page.waitForFunction((id) => {
    const document = window.__lightTableAutomation?.queryDocument(id);
    return document?.renderer.active && document.renderer.status === 'ready'
      && document.tasks.activeCount === 0;
  }, documentId, { timeout: 60_000 });
  await driver.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
    () => requestAnimationFrame(resolve)
  )));
  const document = await driver.queryDocument(documentId);
  const preview = await driver.requestDocumentPreview(documentId, document.canonicalRevision, 640);
  const artifactId = preview?.artifact?.id ?? preview?.id;
  const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
  if (!artifact?.bytes?.length) throw new Error(`Pixel clipboard preview ${target} returned no bytes.`);
  await writeFile(target, artifact.bytes);
};

const waitForLayerCount = (page, documentId, layerCount, undoDepth) => page.waitForFunction(
  ({ documentId, layerCount, undoDepth }) => {
    const automation = window.__lightTableAutomation;
    const document = automation?.queryDocument(documentId);
    const layers = automation?.queryLayers(documentId);
    return document?.renderer.status === 'ready' && layers?.length === layerCount
      && document.history.undoDepth === undoDepth;
  }, { documentId, layerCount, undoDepth }, { timeout: 60_000 }
);

const openActions = async (page) => {
  if (!await page.getByRole('complementary', { name: 'Actions' }).count()) {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  return page.getByRole('complementary', { name: 'Actions' })
    .locator('.lighttable-action-recorder');
};

/** Proves that UI, Actions and MCP use the same bounded pixel-copy/paste route. */
export const runPixelClipboardRouteEquivalence = async ({ page, driver, mcp, output }) => {
  const documentId = (await driver.queryWorkspace()).activeDocumentId;
  assert.ok(documentId, 'Pixel clipboard proof needs an active raster document.');
  const initial = await driver.queryDocument(documentId);
  const initialLayers = await driver.queryLayers(documentId);
  assert.ok(initialLayers.some(({ type }) => type === 'raster'),
    'Pixel clipboard proof needs an active raster layer.');

  const selection = {
    mode: 'replace',
    shape: { kind: 'rectangle', points: [{ x: 32, y: 24 }, { x: 196, y: 148 }] },
    featherRadius: 0,
    antiAlias: false
  };
  await driver.execute(documentId, 'selection.applyShape', selection);
  const afterSelection = await driver.queryDocument(documentId);
  const selectionRevision = afterSelection.canonicalRevision;
  const selectionUndoDepth = afterSelection.history.undoDepth;
  assert.equal(selectionRevision, initial.canonicalRevision,
    'Selection setup unexpectedly changed the canonical document revision.');

  const previews = Object.fromEntries(['ui', 'actions', 'mcp'].map((route) =>
    [route, path.join(output, `pixel-clipboard-${route}.png`)]));
  let recorder = await openActions(page);
  await recorder.getByRole('button', { name: 'Record' }).click();

  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Copy Merged' }).click();
  await page.waitForFunction(() => window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
    .some(({ command }) => command === 'selection.copyPixels'), undefined, { timeout: 30_000 });
  const afterMergedCopy = await driver.queryDocument(documentId);
  assert.equal(afterMergedCopy.canonicalRevision, selectionRevision,
    'Copy Merged changed the canonical document revision.');
  assert.equal(afterMergedCopy.history.undoDepth, selectionUndoDepth,
    'Copy Merged created an undo entry.');

  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await page.waitForFunction(() => window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
    .filter(({ command }) => command === 'selection.copyPixels').length === 2,
  undefined, { timeout: 30_000 });
  const afterActiveCopy = await driver.queryDocument(documentId);
  assert.equal(afterActiveCopy.canonicalRevision, selectionRevision,
    'Copy changed the canonical document revision.');
  assert.equal(afterActiveCopy.history.undoDepth, selectionUndoDepth,
    'Copy created an undo entry.');

  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Paste as new layer' }).click();
  await waitForLayerCount(page, documentId, initialLayers.length + 1, selectionUndoDepth + 1);
  const uiDocument = await driver.queryDocument(documentId);
  const uiLayers = await driver.queryLayers(documentId);
  const uiPastedLayer = uiLayers.find(({ id }) => id === uiDocument.activeLayerId);
  assert.deepEqual(uiPastedLayer?.rasterSurface, {
    width: 164, height: 124, offsetX: 0, offsetY: 0
  }, 'Paste did not retain compact layer-local clipboard bounds.');
  assert.deepEqual(uiLayers.find(({ id }) => id === initialLayers[0].id)?.rasterSurface, {
    width: initial.canvas.width, height: initial.canvas.height, offsetX: 0, offsetY: 0
  }, 'Paste changed the existing full-canvas raster layer.');
  recorder = await openActions(page);
  await recorder.getByRole('button', { name: 'Stop' }).click();
  const recording = await driver.queryActionRecording();
  assert.deepEqual(recording.steps.map(({ command }) => command),
    ['selection.copyPixels', 'selection.copyPixels', 'selection.pastePixels']);
  assert.deepEqual(recording.steps[0].parameters, { source: 'merged' });
  assert.deepEqual(recording.steps[1].parameters, { source: 'active-layer' });
  assert.deepEqual(recording.steps[2].parameters.artifactId,
    { $lighttableResult: { step: 2, path: 'artifact.id' } });
  assert.doesNotMatch(JSON.stringify(recording), /base64|data:|bytesBase64|filePath/iu,
    'The Action retained private pixel bytes or a local path.');
  await writePreview(driver, documentId, previews.ui);

  await driver.execute(documentId, 'history.undo');
  await waitForLayerCount(page, documentId, initialLayers.length, selectionUndoDepth);
  recorder = await openActions(page);
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (
    window.__lightTableAutomation?.actionPlaybackSnapshot?.().status === 'completed'
  ), undefined, { timeout: 60_000 });
  await waitForLayerCount(page, documentId, initialLayers.length + 1, selectionUndoDepth + 1);
  await writePreview(driver, documentId, previews.actions);

  await driver.execute(documentId, 'history.undo');
  await waitForLayerCount(page, documentId, initialLayers.length, selectionUndoDepth);
  const beforeMcpCopy = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId } }), 'MCP pixel copy document');
  const copiedMerged = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'selection.copyPixels',
    expectedDocumentRevision: beforeMcpCopy.canonicalRevision,
    parameters: { source: 'merged' }
  } }), 'MCP Copy Merged Pixels');
  assert.equal(copiedMerged.value.artifact.kind, 'pixel-clipboard');
  assert.deepEqual(copiedMerged.value.bounds, { x: 32, y: 24, width: 164, height: 124 });
  const copied = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'selection.copyPixels',
    expectedDocumentRevision: beforeMcpCopy.canonicalRevision,
    parameters: { source: 'active-layer' }
  } }), 'MCP Copy Pixels');
  assert.equal(copied.value.artifact.kind, 'pixel-clipboard');
  assert.deepEqual(copied.value.bounds, { x: 32, y: 24, width: 164, height: 124 });
  const afterMcpCopy = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId } }), 'MCP post-copy document');
  assert.equal(afterMcpCopy.canonicalRevision, beforeMcpCopy.canonicalRevision,
    'MCP copy changed the canonical document revision.');
  assert.equal(afterMcpCopy.history.undoDepth, beforeMcpCopy.history.undoDepth,
    'MCP copy created an undo entry.');
  mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'selection.pastePixels',
    expectedDocumentRevision: afterMcpCopy.canonicalRevision,
    parameters: {
      artifactId: copied.value.artifact.id, name: 'Pasted Selection',
      bounds: copied.value.bounds
    }
  } }), 'MCP Paste Pixels');
  await waitForLayerCount(page, documentId, initialLayers.length + 1, selectionUndoDepth + 1);
  await writePreview(driver, documentId, previews.mcp);

  const renderEvidence = {};
  for (const route of ['actions', 'mcp']) {
    renderEvidence[route] = await compareRenderEvidence({
      leftPath: previews.ui, rightPath: previews[route],
      width: initial.canvas.width, height: initial.canvas.height,
      sideBySidePath: path.join(output, `pixel-clipboard-ui-vs-${route}.png`),
      differencePath: path.join(output, `pixel-clipboard-ui-vs-${route}-difference.png`),
      policy: strictRenderPolicy
    });
    assert.equal(renderEvidence[route].passed, true,
      `Pixel clipboard UI and ${route} pixels differ.`);
  }

  await driver.execute(documentId, 'history.undo');
  await waitForLayerCount(page, documentId, initialLayers.length, selectionUndoDepth);
  return {
    documentId,
    bounds: copied.value.bounds,
    artifacts: { activeLayer: copied.value.artifact, merged: copiedMerged.value.artifact },
    recording: recording.steps.map(({ command, parameters }) => ({ command, parameters })),
    renderEvidence
  };
};
