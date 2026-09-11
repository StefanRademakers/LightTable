import assert from 'node:assert/strict';
import sharp from 'sharp';

/** Extra real-app lifetime proof for the two live LUT import routes. */
export const proveGradeAssetRebind = async ({ page, driver, sourceId, destinationId, neutral, exportPng, lut }) => {
  const pixels = async id => sharp((await exportPng(id)).bytes).ensureAlpha().raw().toBuffer();
  const neutralPixels = await sharp(neutral).ensureAlpha().raw().toBuffer();
  const graded = await pixels(destinationId);
  const activate = async id => {
    const before = await driver.queryDocument(id);
    const workspace = await driver.queryWorkspace();
    const index = workspace.documents.findIndex(document => document.id === id);
    assert.ok(index >= 0);
    await page.locator('.ui-document-tabs__tab').nth(index).locator('.ui-document-tabs__title').click();
    await page.waitForFunction(id => {
      const doc = window.__lightTableAutomation?.queryDocument(id);
      return window.__lightTableAutomation?.queryWorkspace().activeDocumentId === id
        && doc?.lifecycle === 'ready' && doc.renderer.status === 'ready'
        && doc.renderer.active && doc.tasks.activeCount === 0;
    }, id);
    const after = await driver.queryDocument(id);
    assert.equal(after.canonicalRevision, before.canonicalRevision);
    assert.equal(after.history.undoDepth, before.history.undoDepth);
  };
  await activate(sourceId); await activate(destinationId);
  assert.deepEqual(await pixels(destinationId), graded, 'Imported Grade changed after rebind.');
  await driver.execute(destinationId, 'history.undo', {});
  assert.deepEqual(await pixels(destinationId), neutralPixels, 'Imported Grade undo left pixels behind.');
  await driver.execute(destinationId, 'history.redo', {});
  assert.deepEqual(await pixels(destinationId), graded, 'Imported Grade redo lost its retained LUT.');

  // Copy on this destination must reference its imported immutable asset. Paste
  // back into the same owner must not allocate a UUID or manufacture history.
  const beforeSamePaste = await driver.queryDocument(destinationId);
  const copied = await driver.execute(destinationId, 'grade.copy', {});
  await driver.execute(destinationId, 'grade.paste', { artifactId: copied.value.artifact.id });
  assert.deepEqual(await pixels(destinationId), graded);
  const afterSamePaste = await driver.queryDocument(destinationId);
  assert.equal(afterSamePaste.history.undoDepth, beforeSamePaste.history.undoDepth);
  assert.equal(afterSamePaste.canonicalRevision, beforeSamePaste.canonicalRevision);

  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: /New Color Lookup/ }).click();
  const beforeLut = await pixels(destinationId);
  const beforeLoad = await driver.queryDocument(destinationId);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load .cube...', exact: true }).click();
  await (await chooser).setFiles(lut);
  await page.waitForFunction(({ id, depth }) => {
    const doc = window.__lightTableAutomation?.queryDocument(id);
    return doc?.history.undoDepth === depth + 1 && !doc.history.busy;
  }, { id: destinationId, depth: beforeLoad.history.undoDepth });
  const withLookup = await pixels(destinationId);
  assert.notDeepEqual(withLookup, beforeLut, 'Color Lookup file import had no effect.');
  await activate(sourceId); await activate(destinationId);
  assert.deepEqual(await pixels(destinationId), withLookup);
  await driver.execute(destinationId, 'history.undo', {});
  assert.deepEqual(await pixels(destinationId), beforeLut);
  await driver.execute(destinationId, 'history.redo', {});
  assert.deepEqual(await pixels(destinationId), withLookup);
  return { importedGradeRebindUndoRedo: true, sameOwnerPasteNoOp: true, colorLookupFileRebindUndoRedo: true };
};
