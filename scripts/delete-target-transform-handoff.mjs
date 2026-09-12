import assert from 'node:assert/strict';
import sharp from 'sharp';

/** Real pending selected-pixel transform -> Delete, including its prerequisite history. */
export async function verifyDeleteTransformHandoff(page, driver) {
  const created = await driver.executeWorkspace('document.create', { name: 'Delete pending transform',
    width: 320, height: 240, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#4080b0' } });
  const id = created.value.documentId; await driver.waitForReadyDocument(id, 60000);
  await driver.execute(id, 'selection.applyShape', { mode: 'replace', shape: { kind: 'rectangle',
    points: [{ x: 30, y: 45 }, { x: 100, y: 110 }] }, featherRadius: 0, antiAlias: false });
  const state = () => driver.queryDocument(id);
  const pixels = async () => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId);
    return sharp((await driver.readArtifact(task.artifact.id)).bytes).ensureAlpha().raw().toBuffer();
  };
  const before = await state(), original = await pixels();
  const originalIds = (await driver.queryLayers(id)).map(layer => layer.id);
  await driver.startActionRecording('Pending transform then Delete');
  await page.keyboard.press('Control+t');
  const body = page.locator('.lighttable-transform__body'); await body.waitFor();
  const point = await body.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.x + box.width * .4, y = box.y + box.height * .4;
    return document.elementFromPoint(x, y)?.classList.contains('lighttable-transform__body') ? { x, y } : null;
  });
  assert.ok(point, 'Selected-pixel transform body must be pointer-accessible');
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 95, point.y + 30, { steps: 5 }); await page.mouse.up();
  assert.equal((await state()).history.undoDepth, before.history.undoDepth);
  await page.keyboard.press('Delete');
  await page.waitForFunction(({ id, depth }) => window.__lightTableAutomation.queryDocument(id).history.undoDepth === depth,
    { id, depth: before.history.undoDepth + 2 }, { timeout: 10000 });
  await driver.stopActionRecording();
  const recording = await driver.queryActionRecording();
  const fills = recording.steps.filter(step => step.command === 'raster.fill');
  assert.equal(fills.length, 1); assert.equal(fills[0].parameters.opacity, 0);
  assert.deepEqual((await driver.queryLayers(id)).map(layer => layer.id), originalIds);
  const after = await pixels(); assert.notDeepEqual(after, original);
  let transparent = 0, opaque = 0;
  for (let i = 3; i < after.length; i += 4) { if (after[i] === 0) transparent++; if (after[i] === 255) opaque++; }
  assert.ok(transparent > 0 && opaque > 0, 'Delete must clear selection, never the entire layer');
  await driver.execute(id, 'history.undo', {});
  assert.notDeepEqual(await pixels(), after, 'First undo restores transformed pixels');
  await driver.execute(id, 'history.undo', {}); assert.deepEqual(await pixels(), original);
  await driver.execute(id, 'history.redo', {}); await driver.execute(id, 'history.redo', {});
  assert.deepEqual(await pixels(), after);
  return { kind: 'Pending selected-pixel transform -> Delete', exactUndoRedo: true,
    prerequisiteThenClearHistory: true, oneObservedClear: true, transparent, opaque };
}
