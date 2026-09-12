import assert from 'node:assert/strict';

/** Real Layers thumbnail entry, semantic recording, and exact coverage replay. */
export const verifyTransparencyAction = async ({ page, driver, documentId, recorder, copyPixels }) => {
  const beforeCopy = await copyPixels();
  const before = await driver.queryDocument(documentId);
  const layerId = before.activeLayerId;
  assert.ok(layerId);
  await recorder.getByRole('button', { name: 'Clear', exact: true }).click();
  await recorder.getByRole('button', { name: 'Record', exact: true }).click();
  await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__thumbnail`).first()
    .click({ modifiers: ['Control'] });
  await page.waitForFunction(id => window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
    .some(step => step.command === 'selection.modify' && step.documentId === id), documentId, { timeout: 5_000 });
  await recorder.getByRole('button', { name: 'Stop', exact: true }).click();
  const recorded = await driver.queryActionRecording();
  assert.equal(recorded.steps.length, 1, 'Thumbnail transparency must record exactly one semantic step.');
  assert.equal(recorded.steps[0].command, 'selection.modify');
  assert.deepEqual(recorded.steps[0].parameters, { kind: 'modify', operation: 'load-transparency', layerId });
  const selected = await copyPixels();
  assert.deepEqual(selected.bounds, { x: 0, y: 0, width: 256, height: 192 });
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth, before.history.undoDepth + 1);
  await driver.execute(documentId, 'history.undo');
  const undone = await copyPixels();
  assert.deepEqual(undone.bounds, beforeCopy.bounds);
  assert.deepEqual(undone.image.data, beforeCopy.image.data);
  await driver.execute(documentId, 'history.redo');
  const redone = await copyPixels();
  assert.deepEqual(redone.bounds, selected.bounds);
  assert.deepEqual(redone.image.data, selected.image.data);
  await driver.execute(documentId, 'history.undo');
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__lightTableAutomation?.actionPlaybackSnapshot?.().status === 'completed',
    undefined, { timeout: 10_000 });
  const replayed = await copyPixels();
  assert.deepEqual(replayed.bounds, selected.bounds);
  assert.deepEqual(replayed.image.data, selected.image.data);
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth, before.history.undoDepth + 1);
  return { layerId, oneSemanticStep: true, exactUndoRedo: true, exactActionReplay: true };
};
