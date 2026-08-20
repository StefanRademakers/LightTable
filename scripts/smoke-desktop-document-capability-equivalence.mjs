import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { captureDesktopTestState, resolveDesktopTestLaunch,
  waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { startPackagedMcpTestSession } from './packaged-mcp-test-session.mjs';
import { mcpResult } from './action-route-equivalence.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';
import { runAssignProfileRouteEquivalence } from './assign-profile-route-equivalence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'document-capability-equivalence');
const source = path.join(root, 'architecture', 'ui', '1.png');
await Promise.all([access(source), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const mcpSession = await startPackagedMcpTestSession({ label: 'Document capability equivalence' });
const environment = { ...process.env, ...mcpSession.desktopEnvironment };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

const createDocument = async (mcp, driver, name) => {
  const result = mcpResult(await mcp.callTool({ name: 'lighttable_create_document', arguments: {
    name, width: 640, height: 480, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#28405c' }
  } }), `Create ${name}`);
  const documentId = result.value?.documentId ?? result.documentId;
  if (!documentId) throw new Error(`${name} returned no document ID.`);
  await driver.page.waitForFunction((id) => {
    const document = window.__lightTableAutomation?.queryDocument(id);
    return document?.lifecycle === 'ready' && document.renderer.active
      && document.renderer.status === 'ready';
  }, documentId, { timeout: 60_000 });
  return documentId;
};

const waitForCanvas = (driver, documentId, width, height, undoDepth) => driver.page.waitForFunction(
  ({ documentId, width, height, undoDepth }) => {
    const document = window.__lightTableAutomation?.queryDocument(documentId);
    return document?.canvas?.width === width && document.canvas.height === height
      && document.history.undoDepth === undoDepth && document.renderer.status === 'ready';
  }, { documentId, width, height, undoDepth }, { timeout: 60_000 }
);

const compactState = async (driver, documentId) => {
  const document = await driver.queryDocument(documentId);
  const layers = await driver.queryLayers(documentId);
  return {
    canvas: document.canvas,
    undoDepth: document.history.undoDepth,
    redoDepth: document.history.redoDepth,
    layerCount: document.layerCount,
    layers: layers.map((layer) => ({
      type: layer.type, name: layer.name, visible: layer.visible,
      opacity: layer.opacity, fillOpacity: layer.fillOpacity,
      blendMode: layer.blendMode, transform: layer.transform,
      rasterSurface: layer.rasterSurface, hasMask: layer.hasMask
    }))
  };
};

const writeDriverPreview = async (driver, documentId, target) => {
  const document = await driver.queryDocument(documentId);
  const result = await driver.requestDocumentPreview(documentId, document.canonicalRevision, 640);
  const artifactId = result?.artifact?.id ?? result?.id;
  const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
  if (!artifact?.bytes?.length) throw new Error(`Preview ${target} returned no bytes.`);
  await writeFile(target, artifact.bytes);
};

const strictRenderPolicy = {
  maximumRmse: 0, maximumMeanAbsoluteError: 0,
  maximumChannelRmse: 0, maximumChannelMeanAbsoluteError: 0,
  maximumP95PixelDelta: 0, maximumChangedPixelRatioAt16: 0
};

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: source }, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile: source, pageErrors, label: 'document-capability-equivalence' });
  await open.click();
  try {
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ timeout: 60_000 });
  } catch (error) {
    const diagnostic = await captureDesktopTestState({ app, page, outputDirectory: output,
      sourceFile: source, pageErrors, label: 'document-capability-open', timeout: 60_000 });
    throw new Error(`Document capability source did not open. Diagnostic: ${diagnostic}`, {
      cause: error
    });
  }
  const driver = await attachLightTableAutomation(page, 'document-capability-equivalence');
  const mcp = await mcpSession.pairAndAuthorize(page);
  const profileEvidence = await runAssignProfileRouteEquivalence({ page, driver, mcp, output });

  const uiDocumentId = await createDocument(mcp, driver, 'Geometry UI');
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  let panel = page.getByRole('complementary', { name: 'Actions' });
  let recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();

  await page.keyboard.press('Control+Alt+i');
  const imageSize = page.getByRole('dialog', { name: 'Image Size' });
  await imageSize.waitFor();
  const width = imageSize.getByLabel('Width', { exact: true });
  const height = imageSize.getByLabel('Height', { exact: true });
  await width.fill('320');
  await width.press('Enter');
  let linkedHeight = Number(await height.inputValue());
  for (let attempt = 0; attempt < 40 && linkedHeight !== 240; attempt += 1) {
    await page.waitForTimeout(25);
    linkedHeight = Number(await height.inputValue());
  }
  assert.equal(linkedHeight, 240, 'Image Size did not preserve the linked aspect ratio.');
  await imageSize.getByRole('combobox', { name: 'Resampling method' }).selectOption('bilinear');
  await imageSize.getByRole('button', { name: 'OK' }).click();
  await waitForCanvas(driver, uiDocumentId, 320, 240, 1);

  await page.getByRole('menuitem', { name: 'Image' }).click();
  await page.getByRole('menuitem', { name: 'Image Rotation' }).hover();
  await page.getByRole('menuitem', { name: '90° Clockwise' }).click();
  await waitForCanvas(driver, uiDocumentId, 240, 320, 2);
  if (!await page.getByRole('complementary', { name: 'Actions' }).count()) {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  panel = page.getByRole('complementary', { name: 'Actions' });
  recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Stop' }).click();
  const recording = await driver.queryActionRecording();
  assert.deepEqual(recording.steps.map(({ command }) => command),
    ['document.resizeImage', 'document.applyGeometry']);
  assert.deepEqual(recording.steps[0].result, { width: 320, height: 240, resolutionPpi: 72 });
  assert.deepEqual(recording.steps[1].result, { operation: 'rotate', width: 240, height: 320 });

  const actionsDocumentId = await createDocument(mcp, driver, 'Geometry Actions');
  if (!await page.getByRole('complementary', { name: 'Actions' }).count()) {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await page.getByRole('complementary', { name: 'Actions' })
    .locator('.lighttable-action-recorder').getByRole('button', { name: 'Play', exact: true }).click();
  await waitForCanvas(driver, actionsDocumentId, 240, 320, 2);
  await page.waitForFunction(() => window.__lightTableAutomation?.actionPlaybackSnapshot?.().status === 'completed');

  const mcpDocumentId = await createDocument(mcp, driver, 'Geometry MCP');
  let mcpDocument = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId: mcpDocumentId } }), 'MCP geometry document');
  const resized = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: mcpDocumentId, command: 'document.resizeImage',
    expectedDocumentRevision: mcpDocument.canonicalRevision,
    parameters: { width: 320, height: 240, resolutionPpi: 72, resample: true,
      method: 'bilinear', preserveDetailsNoiseReduction: 0, scaleStyles: true }
  } }), 'MCP Image Size');
  assert.deepEqual(resized.value, { width: 320, height: 240, resolutionPpi: 72 });
  mcpDocument = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId: mcpDocumentId } }), 'MCP resized document');
  const rotated = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: mcpDocumentId, command: 'document.applyGeometry',
    expectedDocumentRevision: mcpDocument.canonicalRevision,
    parameters: { operation: 'rotate', rotation: 'clockwise-90' }
  } }), 'MCP rotate');
  assert.deepEqual(rotated.value, { operation: 'rotate', width: 240, height: 320 });
  await waitForCanvas(driver, mcpDocumentId, 240, 320, 2);

  const states = {
    ui: await compactState(driver, uiDocumentId),
    actions: await compactState(driver, actionsDocumentId),
    mcp: await compactState(driver, mcpDocumentId)
  };
  assert.deepEqual(states.actions, states.ui, 'Actions document state differs from UI.');
  assert.deepEqual(states.mcp, states.ui, 'MCP document state differs from UI.');

  const previews = Object.fromEntries(['ui', 'actions', 'mcp'].map((route) =>
    [route, path.join(output, `${route}.png`)]));
  await writeDriverPreview(driver, uiDocumentId, previews.ui);
  await writeDriverPreview(driver, actionsDocumentId, previews.actions);
  mcpDocument = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId: mcpDocumentId } }), 'MCP preview revision');
  const mcpPreview = await mcp.callTool({ name: 'lighttable_preview', arguments: {
    documentId: mcpDocumentId, expectedDocumentRevision: mcpDocument.canonicalRevision, maxEdge: 640
  } });
  const mcpImage = mcpPreview.content?.find(({ type }) => type === 'image');
  if (!mcpImage?.data) throw new Error('MCP geometry preview returned no image.');
  await writeFile(previews.mcp, Buffer.from(mcpImage.data, 'base64'));
  const renderEvidence = {};
  for (const route of ['actions', 'mcp']) {
    renderEvidence[route] = await compareRenderEvidence({ leftPath: previews.ui,
      rightPath: previews[route], width: 240, height: 320,
      sideBySidePath: path.join(output, `ui-vs-${route}.png`),
      differencePath: path.join(output, `ui-vs-${route}-difference.png`),
      policy: strictRenderPolicy });
    assert.equal(renderEvidence[route].passed, true, `UI and ${route} pixels differ.`);
  }
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    profileEvidence, states, renderEvidence
  }, null, 2)}\n`);
  process.stdout.write(`Packaged document capability equivalence passed: ${output}\n`);
} finally {
  await app?.close().catch(() => {});
  await mcpSession.close().catch(() => {});
}
