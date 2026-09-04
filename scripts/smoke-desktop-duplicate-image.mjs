import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { LIGHTTABLE_COMMAND_EXAMPLES } from '../packages/command-contract/src/index.mjs';
import {
  assertEquivalentRouteStates,
  mcpResult,
  normalizeRouteState
} from './action-route-equivalence.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { startPackagedMcpTestSession } from './packaged-mcp-test-session.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tmp', 'duplicate-image-smoke');
const source = path.resolve(process.env.LIGHTTABLE_DUPLICATE_SMOKE_SOURCE
  ?? path.join(root, 'packages', 'lighttable-app', 'src', 'assets', 'icons', 'image.png'));
await Promise.all([access(source), mkdir(output, { recursive: true })]);
const userData = await mkdtemp(path.join(output, 'profile-'));
const reportPath = path.join(output, 'report.json');
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const mcpSession = await startPackagedMcpTestSession({ label: 'LightTable document duplicate equivalence' });
const environment = { ...process.env, ...mcpSession.desktopEnvironment,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData, LIGHTTABLE_AUTOMATION_OPEN_FILE: source };
delete environment.ELECTRON_RUN_AS_NODE;
const strictRenderPolicy = {
  maximumRmse: 0, maximumMeanAbsoluteError: 0,
  maximumChannelRmse: 0, maximumChannelMeanAbsoluteError: 0,
  maximumP95PixelDelta: 0, maximumChangedPixelRatioAt16: 0
};
const routeFiles = Object.fromEntries(['ui', 'actions', 'mcp'].map((route) => [
  route, path.join(output, `duplicate-${route}.png`)
]));
const pageErrors = [];
let workflowPhase = 'launch';
let app;

const waitForDocument = (driver, documentId) => driver.page.waitForFunction((id) => {
  const document = window.__lightTableAutomation?.queryDocument(id);
  return document?.lifecycle === 'ready' && document.renderer.active
    && document.renderer.status === 'ready';
}, documentId, { timeout: 120_000 });

const collectState = async (driver, documentId) => {
  const document = await driver.queryDocument(documentId);
  const layers = await driver.queryLayers(documentId);
  const vectors = await Promise.all(layers.filter(({ type }) => type === 'vector')
    .map(({ id }) => driver.queryVector(documentId, id)));
  const texts = await Promise.all(layers.filter(({ type }) => type === 'text')
    .map(({ id }) => driver.queryText(documentId, id)));
  return { document, layers, vectors, texts };
};

const normalizeDuplicateState = (state) => {
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key, key === 'assetId' && typeof child === 'string' ? '$fresh-asset' : visit(child)
    ]));
  };
  return visit(normalizeRouteState(state));
};

const writePreview = async (driver, documentId, target) => {
  const document = await driver.queryDocument(documentId);
  const preview = await driver.requestDocumentPreview(documentId, document.canonicalRevision, 1024);
  const artifactId = preview?.artifact?.id ?? preview?.id;
  const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
  if (!artifact?.bytes?.length) throw new Error(`Duplicate preview ${target} returned no bytes.`);
  await writeFile(target, artifact.bytes);
};

const openActions = async (page) => {
  const tab = page.locator('.ui-panel-tab', { hasText: 'Actions' });
  if (!await tab.count()) {
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: /Actions panel/ }).click();
    await tab.first().waitFor({ state: 'visible' });
  }
  await tab.first().click();
  const panel = page.locator('.lighttable-actions-panel');
  await panel.waitFor({ state: 'visible' });
  return panel.locator('.lighttable-action-recorder');
};

try {
  app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
    cwd: root, env: environment, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(`[${workflowPhase}] ${error.stack ?? error.message}`));
  const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile: source, pageErrors, label: 'duplicate-image' });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'duplicate-image', 30_000);
  const mcp = await mcpSession.pairAndAuthorize(page);
  const sourceDocumentId = (await driver.queryWorkspace()).activeDocumentId;
  assert.ok(sourceDocumentId, 'Duplicate proof did not open its source document.');
  await waitForDocument(driver, sourceDocumentId);

  workflowPhase = 'representative-source';
  const sourceDocument = await driver.queryDocument(sourceDocumentId);
  const width = sourceDocument.canvas.width;
  const height = sourceDocument.canvas.height;
  const vectorExample = structuredClone(LIGHTTABLE_COMMAND_EXAMPLES['vector.create'][0]);
  vectorExample.layerName = 'Variant shape';
  vectorExample.primitive = { kind: 'rectangle', x: 0, y: 0,
    width: Math.max(8, width * 0.42), height: Math.max(8, height * 0.34),
    cornerRadii: [4, 4, 4, 4], linkedCorners: true };
  vectorExample.transform = { a: 1, b: 0, c: 0, d: 1, tx: width * 0.08, ty: height * 0.1 };
  await driver.execute(sourceDocumentId, 'vector.create', vectorExample);
  await driver.execute(sourceDocumentId, 'text.create', {
    mode: 'point', text: 'Editable variant', origin: { x: width * 0.12, y: height * 0.72 },
    name: 'Variant title', style: { fontSize: Math.max(8, Math.min(36, height * 0.12)),
      syntheticBold: true, fill: { enabled: true, color: '#f5f1e8' } },
    paragraph: { alignment: 'start' }
  });
  await driver.execute(sourceDocumentId, 'grade.setBasic', {
    target: { kind: 'document' }, values: { exposureEV: 0.2, vibrance: 12 }
  });
  const sourceBefore = await collectState(driver, sourceDocumentId);
  const sourceWorkspaceBefore = (await driver.queryWorkspace()).documents
    .find(({ id }) => id === sourceDocumentId);
  assert.ok(sourceBefore.layers.some(({ type }) => type === 'raster')
    && sourceBefore.layers.some(({ type }) => type === 'vector')
    && sourceBefore.layers.some(({ type }) => type === 'text'),
  'The duplicate source is not a representative editable layered document.');

  workflowPhase = 'ui-route';
  let recorder = await openActions(page);
  await recorder.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate Image' });
  await dialog.getByLabel('As').fill('Agent variant');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction((sourceId) => {
    const workspace = window.__lightTableAutomation?.queryWorkspace();
    return workspace?.activeDocumentId && workspace.activeDocumentId !== sourceId;
  }, sourceDocumentId, { timeout: 120_000 });
  const uiDocumentId = (await driver.queryWorkspace()).activeDocumentId;
  assert.ok(uiDocumentId && uiDocumentId !== sourceDocumentId, 'UI Duplicate returned no fresh document.');
  await waitForDocument(driver, uiDocumentId);
  const uiBaseline = await collectState(driver, uiDocumentId);
  assert.equal(uiBaseline.document.history.undoDepth, 0,
    'A duplicated document did not start with empty history.');
  const sourceIds = new Set(sourceBefore.layers.map(({ id }) => id));
  assert.equal(uiBaseline.layers.some(({ id }) => sourceIds.has(id)), false,
    'The duplicate retained a source layer identity.');
  await page.getByRole('menuitem', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Raster Layer', exact: true }).click();
  await page.waitForFunction((id) => window.__lightTableAutomation?.queryDocument(id)?.history.undoDepth === 1,
  uiDocumentId, { timeout: 30_000 });
  recorder = await openActions(page);
  await recorder.getByRole('button', { name: 'Stop', exact: true }).click();
  const recording = await driver.queryActionRecording();
  assert.deepEqual(recording.steps.map(({ command }) => command),
    ['document.duplicate', 'layer.createRaster']);
  assert.equal(recording.steps[0].documentId, sourceDocumentId);
  assert.equal(recording.steps[0].result.documentId, uiDocumentId);
  assert.equal(recording.steps[1].documentId, uiDocumentId);
  const uiState = normalizeDuplicateState(await collectState(driver, uiDocumentId));
  await writePreview(driver, uiDocumentId, routeFiles.ui);

  workflowPhase = 'actions-route';
  const sourceTitle = sourceWorkspaceBefore?.title ?? path.basename(source);
  await page.getByRole('tab', { name: new RegExp(sourceTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .first().click();
  await waitForDocument(driver, sourceDocumentId);
  recorder = await openActions(page);
  const editStep = recorder.locator('.lighttable-action-tree__row.is-step[data-command="layer.createRaster"]');
  await editStep.click();
  const inspector = recorder.locator('.lighttable-action-inspector');
  await inspector.locator('summary').click();
  await inspector.getByRole('button', { name: 'Play from here', exact: true }).click();
  await page.waitForFunction((sourceId) => {
    const automation = window.__lightTableAutomation;
    return automation?.actionPlaybackSnapshot?.().status === 'completed'
      && automation.queryWorkspace()?.activeDocumentId !== sourceId;
  }, sourceDocumentId, { timeout: 120_000 });
  const actionsDocumentId = (await driver.queryWorkspace()).activeDocumentId;
  assert.ok(actionsDocumentId && actionsDocumentId !== sourceDocumentId && actionsDocumentId !== uiDocumentId,
    'Actions did not create and activate a fresh duplicate.');
  assert.deepEqual((await driver.queryActionPlayback()).results.map(({ sequence }) => sequence), [1, 2],
    'Play From Here did not execute the required duplicate producer before the edit.');
  await waitForDocument(driver, actionsDocumentId);
  const actionsState = normalizeDuplicateState(await collectState(driver, actionsDocumentId));
  await writePreview(driver, actionsDocumentId, routeFiles.actions);

  workflowPhase = 'mcp-route';
  await page.getByRole('tab', { name: new RegExp(sourceTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .first().click();
  await waitForDocument(driver, sourceDocumentId);
  const beforeMcp = mcpResult(await mcp.callTool({ name: 'lighttable_document',
    arguments: { documentId: sourceDocumentId } }), 'MCP duplicate source query');
  const rejected = await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: sourceDocumentId, command: 'document.duplicate',
    expectedDocumentRevision: beforeMcp.canonicalRevision,
    parameters: { name: 'Private variant', mergedLayersOnly: true, sourcePath: 'D:/private.psd' }
  } });
  assert.equal(rejected.isError, true, 'MCP accepted private Duplicate options.');
  assert.equal((await driver.queryDocument(sourceDocumentId)).canonicalRevision,
    beforeMcp.canonicalRevision, 'Rejected MCP Duplicate changed the source.');
  const mcpDuplicate = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: sourceDocumentId, command: 'document.duplicate',
    expectedDocumentRevision: beforeMcp.canonicalRevision,
    parameters: { name: 'Agent variant' }
  } }), 'MCP Duplicate document');
  const mcpDocumentId = mcpDuplicate.value.documentId;
  assert.ok(mcpDocumentId && mcpDocumentId !== sourceDocumentId, 'MCP returned no fresh duplicate ID.');
  await waitForDocument(driver, mcpDocumentId);
  const mcpBaseline = await driver.queryDocument(mcpDocumentId);
  assert.equal(mcpBaseline.history.undoDepth, 0, 'MCP duplicate did not start with empty history.');
  mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: mcpDocumentId, command: 'layer.createRaster',
    expectedDocumentRevision: mcpBaseline.canonicalRevision, parameters: {}
  } }), 'MCP edit duplicate');
  const mcpState = normalizeDuplicateState(await collectState(driver, mcpDocumentId));
  await writePreview(driver, mcpDocumentId, routeFiles.mcp);

  assertEquivalentRouteStates({ ui: uiState, actions: actionsState, mcp: mcpState });
  const renderEvidence = {};
  for (const route of ['actions', 'mcp']) {
    renderEvidence[route] = await compareRenderEvidence({
      leftPath: routeFiles.ui, rightPath: routeFiles[route],
      width, height,
      sideBySidePath: path.join(output, `duplicate-ui-vs-${route}.png`),
      differencePath: path.join(output, `duplicate-ui-vs-${route}-difference.png`),
      policy: strictRenderPolicy
    });
    assert.equal(renderEvidence[route].passed, true,
      `Duplicate UI and ${route} pixels differ.`);
  }

  const sourceAfter = await collectState(driver, sourceDocumentId);
  const sourceWorkspaceAfter = (await driver.queryWorkspace()).documents
    .find(({ id }) => id === sourceDocumentId);
  assert.deepEqual(normalizeRouteState(sourceAfter), normalizeRouteState(sourceBefore),
    'Creating or editing duplicates changed the source document.');
  assert.deepEqual({ dirty: sourceWorkspaceAfter?.dirty,
    history: sourceAfter.document.history, canonicalRevision: sourceAfter.document.canonicalRevision },
  { dirty: sourceWorkspaceBefore?.dirty,
    history: sourceBefore.document.history, canonicalRevision: sourceBefore.document.canonicalRevision },
  'Duplicate creation changed source dirty/history/revision state.');
  assert.equal(pageErrors.length, 0, `Duplicate route emitted page errors: ${pageErrors.join('\n')}`);

  await writeFile(reportPath, `${JSON.stringify({
    packagedDesktop: launch.mode === 'production-packaged', passed: true,
    source: { documentId: sourceDocumentId, layerCount: sourceBefore.layers.length,
      canonicalRevision: sourceBefore.document.canonicalRevision,
      history: sourceBefore.document.history, dirty: sourceWorkspaceBefore?.dirty },
    routes: {
      ui: { documentId: uiDocumentId }, actions: { documentId: actionsDocumentId },
      mcp: { documentId: mcpDocumentId }
    },
    recording: recording.steps.map(({ command, documentId, result }) => ({ command, documentId, result })),
    actionPlayback: (await driver.queryActionPlayback()).results,
    finalLayerCount: (await driver.queryLayers(mcpDocumentId)).length,
    renderEvidence, pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Desktop Duplicate Image UI/Actions/MCP equivalence passed. Report: ${reportPath}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await mcpSession.close().catch(() => undefined);
}
