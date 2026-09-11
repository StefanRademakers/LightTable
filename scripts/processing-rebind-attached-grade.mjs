import assert from 'node:assert/strict';

/** Actual inspector intent; reads only public canonical queries and fresh exports. */
export const verifyAttachedGradeInspector = async ({ page, driver, documentId, layerId, pixels }) => {
  const detail = async () => page.evaluate(request => window.__lightTableAutomation.queryLayerDetail(request),
    { documentId, layerId });
  const parentBefore = (await driver.queryAdjustment(documentId, { kind: 'layer', layerId })).stack;
  await driver.execute(documentId, 'adjustment.create', { kind: 'exposure', placement: 'attached', layerId });
  const sibling = (await detail()).content.attachedAdjustments[0];
  await driver.execute(documentId, 'adjustment.create', { kind: 'grade', placement: 'attached', layerId });
  const grade = (await detail()).content.attachedAdjustments.find(item => item.adjustmentKind === 'grade');
  assert.ok(grade);
  const row = page.locator('.lighttable-layer-effect').filter({
    has: page.getByRole('button', { name: 'Disable attached Grade', exact: true })
  });
  await row.getByRole('button', { name: 'Grade', exact: true }).click();
  const exposure = page.getByRole('slider', { name: 'Exposure', exact: true });
  await exposure.focus();
  await page.keyboard.press('ArrowRight');
  const before = await pixels(documentId);
  const history = (await driver.queryDocument(documentId)).history.undoDepth;
  await page.getByRole('switch', { name: 'Disable Local Grade', exact: true }).click();
  await page.getByRole('switch', { name: 'Enable Local Grade', exact: true }).waitFor();
  const disabled = await pixels(documentId);
  assert.notDeepEqual(disabled, before, 'Attached Grade master did not bypass its pixels.');
  const after = await detail();
  assert.equal(after.content.attachedAdjustments.find(item => item.id === grade.id).enabled, false);
  assert.deepEqual(after.content.attachedAdjustments.find(item => item.id === sibling.id), sibling);
  assert.deepEqual((await driver.queryAdjustment(documentId, { kind: 'layer', layerId })).stack, parentBefore);
  assert.equal((await driver.queryDocument(documentId)).history.undoDepth, history + 1);
  await driver.execute(documentId, 'history.undo');
  await page.getByRole('switch', { name: 'Disable Local Grade', exact: true }).waitFor();
  assert.deepEqual(await pixels(documentId), before);
  await driver.execute(documentId, 'history.redo');
  await page.getByRole('switch', { name: 'Enable Local Grade', exact: true }).waitFor();
  assert.deepEqual(await pixels(documentId), disabled);
  return 'Attached Grade master: exact attachment, unchanged sibling/base stack, one undo and exact redo pixels.';
};
