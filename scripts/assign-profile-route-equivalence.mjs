import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mcpResult } from './action-route-equivalence.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

const waitForProfile = (page, documentId, profileState, undoDepth) => page.waitForFunction(
  ({ documentId, profileState, undoDepth }) => {
    const document = window.__lightTableAutomation?.queryDocument(documentId);
    return document?.color?.profileState === profileState
      && document.color.workingProfile === 'srgb'
      && document.history.undoDepth === undoDepth
      && document.renderer.status === 'ready';
  }, { documentId, profileState, undoDepth }, { timeout: 60_000 }
);

const writePreview = async (driver, documentId, target) => {
  const document = await driver.queryDocument(documentId);
  const preview = await driver.requestDocumentPreview(documentId, document.canonicalRevision, 640);
  const artifactId = preview?.artifact?.id ?? preview?.id;
  const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
  if (!artifact?.bytes?.length) throw new Error(`Profile preview ${target} returned no bytes.`);
  await writeFile(target, artifact.bytes);
};

const strictRenderPolicy = {
  maximumRmse: 0, maximumMeanAbsoluteError: 0,
  maximumChannelRmse: 0, maximumChannelMeanAbsoluteError: 0,
  maximumP95PixelDelta: 0, maximumChangedPixelRatioAt16: 0
};

/** Exercises metadata-only profile assignment before another equivalence flow reuses the app. */
export const runAssignProfileRouteEquivalence = async ({ page, driver, mcp, output }) => {
  const documentId = (await driver.queryWorkspace()).activeDocumentId;
  assert.ok(documentId, 'Assign Profile proof needs the opened source document.');
  const initial = await driver.queryDocument(documentId);
  assert.equal(initial.color.profileState, 'assumed',
    'The untagged PNG fixture must exercise assignment rather than a no-op.');
  assert.equal(initial.history.undoDepth, 0);
  const previews = Object.fromEntries(['before', 'ui', 'actions', 'mcp'].map((route) =>
    [route, path.join(output, `profile-${route}.png`)]));
  await writePreview(driver, documentId, previews.before);

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  let recorder = page.getByRole('complementary', { name: 'Actions' })
    .locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: 'Assign Profile' }).hover();
  await page.getByRole('menuitem', { name: /^sRGB/u }).click();
  await waitForProfile(page, documentId, 'assigned', 1);
  await writePreview(driver, documentId, previews.ui);
  if (!await page.getByRole('complementary', { name: 'Actions' }).count()) {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  recorder = page.getByRole('complementary', { name: 'Actions' })
    .locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Stop' }).click();
  const recording = await driver.queryActionRecording();
  assert.deepEqual(recording.steps.map(({ command }) => command), ['document.assignProfile']);
  assert.deepEqual(recording.steps[0].result,
    { profile: 'srgb', profileState: 'assigned', changed: true });

  await driver.execute(documentId, 'history.undo');
  await waitForProfile(page, documentId, 'assumed', 0);
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (
    window.__lightTableAutomation?.actionPlaybackSnapshot?.().status === 'completed'
  ));
  await waitForProfile(page, documentId, 'assigned', 1);
  await writePreview(driver, documentId, previews.actions);

  await driver.execute(documentId, 'history.undo');
  await waitForProfile(page, documentId, 'assumed', 0);
  let document = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId } }), 'MCP profile document');
  const assigned = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'document.assignProfile',
    expectedDocumentRevision: document.canonicalRevision,
    parameters: { profile: 'srgb' }
  } }), 'MCP Assign Profile');
  assert.deepEqual(assigned.value,
    { profile: 'srgb', profileState: 'assigned', changed: true });
  await waitForProfile(page, documentId, 'assigned', 1);
  await writePreview(driver, documentId, previews.mcp);

  document = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId } }), 'MCP assigned profile document');
  const repeated = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId, command: 'document.assignProfile',
    expectedDocumentRevision: document.canonicalRevision,
    parameters: { profile: 'srgb' }
  } }), 'MCP repeated Assign Profile');
  assert.equal(repeated.value.changed, false);
  await waitForProfile(page, documentId, 'assigned', 1);

  const renderEvidence = {};
  for (const route of ['ui', 'actions', 'mcp']) {
    renderEvidence[route] = await compareRenderEvidence({
      leftPath: previews.before, rightPath: previews[route],
      width: initial.canvas.width, height: initial.canvas.height,
      sideBySidePath: path.join(output, `profile-before-vs-${route}.png`),
      differencePath: path.join(output, `profile-before-vs-${route}-difference.png`),
      policy: strictRenderPolicy
    });
    assert.equal(renderEvidence[route].passed, true,
      `Assign Profile changed rendered pixels through ${route}.`);
  }

  await driver.execute(documentId, 'history.undo');
  await waitForProfile(page, documentId, 'assumed', 0);
  await recorder.getByRole('button', { name: 'Clear' }).click();
  assert.equal((await driver.queryActionRecording()).steps.length, 0);
  return { documentId, initialColor: initial.color, renderEvidence };
};
