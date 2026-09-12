import assert from 'node:assert/strict';
import sharp from 'sharp';

/** Actual pending transform -> contextual creation, without an explicit Enter first. */
export async function verifyAdjustmentCreationTransformHandoff(page, driver) {
  const created = await driver.executeWorkspace('document.create', { name: 'Pending transform creation',
    width: 320, height: 200, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#4080b0' } });
  const id = created.value?.documentId; assert.ok(id); await driver.waitForReadyDocument(id, 60000);
  const baseline = await driver.queryDocument(id), layerId = baseline.activeLayerId;
  const originalLayer = (await driver.queryLayers(id)).find(layer => layer.id === layerId);
  const pixels = async () => {
    const accepted = await driver.execute(id, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(id, accepted.taskId);
    const artifact = await driver.readArtifact(task.artifact.id);
    return sharp(artifact.bytes).ensureAlpha().raw().toBuffer();
  };
  const original = await pixels();
  await page.keyboard.press('Control+t');
  const body = page.locator('.lighttable-transform__body'); await body.waitFor({ state: 'visible' });
  const point = await body.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (const fraction of [0.25, 0.4, 0.6]) {
      const x = box.x + box.width * fraction, y = box.y + box.height * 0.4;
      if (document.elementFromPoint(x, y)?.classList.contains('lighttable-transform__body')) return { x, y };
    }
    return null;
  });
  assert.ok(point, 'Actual transform body must be pointer-accessible');
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 45, point.y + 25, { steps: 5 }); await page.mouse.up();
  assert.equal((await driver.queryDocument(id)).history.undoDepth, baseline.history.undoDepth,
    'Pointer-up leaves the transform pending, not canonically committed');
  await page.keyboard.press('Control+m');
  await page.getByRole('complementary', { name: 'Curves properties', exact: true }).waitFor({ state: 'visible' });
  await body.waitFor({ state: 'hidden' });
  assert.equal((await driver.queryDocument(id)).history.undoDepth, baseline.history.undoDepth + 2,
    'Existing queue must allow its own transform prerequisite, then one Curves creation');
  const transformed = (await driver.queryLayers(id)).find(layer => layer.id === layerId);
  assert.notDeepEqual(transformed.transform, originalLayer.transform);
  const after = await pixels(); assert.notDeepEqual(after, original);
  await driver.execute(id, 'history.undo', {});
  assert.deepEqual((await driver.queryLayers(id)).find(layer => layer.id === layerId).transform, transformed.transform);
  await driver.execute(id, 'history.undo', {}); assert.deepEqual(await pixels(), original);
  await driver.execute(id, 'history.redo', {}); await driver.execute(id, 'history.redo', {});
  assert.deepEqual(await pixels(), after);
  return { kind: 'actual pending transform -> Ctrl+M', prerequisiteCommitAccepted: true,
    separateHistory: true, transformPreserved: true, exactUndoRedoPixels: true };
}
