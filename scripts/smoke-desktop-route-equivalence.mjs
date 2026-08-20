import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  assertEquivalentRouteStates,
  mcpResult,
  normalizeRouteState,
  resolveRecordedParameters
} from './action-route-equivalence.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { startPackagedMcpTestSession } from './packaged-mcp-test-session.mjs';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'route-equivalence-smoke');
await Promise.all([access(fixture), mkdir(output, { recursive: true })]);
const uiExportPath = path.join(output, 'ui-file-menu-export.png');
const userData = await mkdtemp(path.join(output, 'profile-'));
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const mcpSession = await startPackagedMcpTestSession({ label: 'LightTable route equivalence' });
const environment = { ...process.env, ...mcpSession.desktopEnvironment };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
let app;

const waitForDocument = async (driver, documentId) => {
  await driver.page.waitForFunction((id) => {
    const state = window.__lightTableAutomation?.queryDocument(id);
    return state?.lifecycle === 'ready' && state.renderer.active && state.renderer.status === 'ready';
  }, documentId, { timeout: 60_000 });
};

const createDocument = async (driver, name) => {
  const result = await driver.executeWorkspace('document.create', {
    name, width: 640, height: 480, resolutionPpi: 72, bitDepth: 8, profile: 'srgb',
    background: { kind: 'solid', color: '#182238' }
  });
  const documentId = result.value?.documentId;
  if (!documentId) throw new Error(`${name} did not return a document ID.`);
  await waitForDocument(driver, documentId);
  return documentId;
};

const createDocumentThroughMcp = async (mcp, driver, name) => {
  const created = mcpResult(await mcp.callTool({ name: 'lighttable_create_document', arguments: {
    name, width: 640, height: 480, resolutionPpi: 72, bitDepth: '8',
    profile: 'srgb', backgroundColor: '#182238'
  } }), `MCP setup document ${name}`);
  const documentId = created.value?.documentId ?? created.documentId;
  if (!documentId) throw new Error(`MCP create returned no document: ${JSON.stringify(created)}`);
  await waitForDocument(driver, documentId);
  return documentId;
};

const collectDriverState = async (driver, documentId) => {
  const document = await driver.queryDocument(documentId);
  const layers = await driver.queryLayers(documentId);
  const vectors = await Promise.all(layers.filter(({ type }) => type === 'vector')
    .map(({ id }) => driver.queryVector(documentId, id)));
  const texts = await Promise.all(layers.filter(({ type }) => type === 'text')
    .map(({ id }) => driver.queryText(documentId, id)));
  return { document, layers, vectors, texts };
};

const collectMcpState = async (mcp, documentId) => {
  const document = mcpResult(await mcp.callTool({
    name: 'lighttable_document', arguments: { documentId }
  }), 'MCP document query');
  const layerPage = mcpResult(await mcp.callTool({
    name: 'lighttable_layers', arguments: {
      documentId, expectedDocumentRevision: document.canonicalRevision, limit: 128
    }
  }), 'MCP layer query');
  const layers = Array.isArray(layerPage) ? layerPage : layerPage.layers;
  const vectors = await Promise.all(layers.filter(({ type }) => type === 'vector').map(async ({ id }) =>
    mcpResult(await mcp.callTool({ name: 'lighttable_vector', arguments: { documentId, layerId: id } }),
      `MCP vector query ${id}`)));
  const texts = await Promise.all(layers.filter(({ type }) => type === 'text').map(async ({ id }) =>
    mcpResult(await mcp.callTool({ name: 'lighttable_text', arguments: { documentId, layerId: id } }),
      `MCP text query ${id}`)));
  return { document, layers, vectors, texts };
};

const assertUndoRedoRoundtrip = async ({ route, readState, undo, redo }) => {
  const before = normalizeRouteState(await readState());
  const history = before.document.history;
  assert.ok(history.undoLabel, `${route} did not expose the logical Undo label.`);
  await undo();
  const undone = normalizeRouteState(await readState());
  assert.equal(undone.document.history.redoLabel, history.undoLabel,
    `${route} Redo label did not identify the undone edit.`);
  await redo();
  const restored = normalizeRouteState(await readState());
  assert.equal(restored.document.canonicalRevision, before.document.canonicalRevision + 2,
    `${route} Undo/Redo did not publish two revisions.`);
  const revisionNeutral = structuredClone(restored);
  revisionNeutral.document.canonicalRevision = before.document.canonicalRevision;
  assert.deepEqual(revisionNeutral, before, `${route} Undo/Redo did not restore canonical state.`);
  return { undoLabel: history.undoLabel, redoLabelAfterUndo: undone.document.history.redoLabel,
    beforeRevision: before.document.canonicalRevision,
    restoredRevision: restored.document.canonicalRevision };
};

const writeDriverPreview = async (driver, documentId, target) => {
  const document = await driver.queryDocument(documentId);
  const artifact = await driver.requestDocumentPreview(documentId, document.canonicalRevision, 640);
  const artifactId = artifact?.artifact?.id ?? artifact?.id;
  const file = artifactId ? await driver.readArtifact(artifactId) : null;
  if (!file?.bytes?.length) {
    throw new Error(`Preview ${target} has no bytes: ${JSON.stringify(artifact)}`);
  }
  await writeFile(target, file.bytes);
};

const keyboardHistory = async (window, driver, documentId, direction) => {
  const before = await driver.queryDocument(documentId);
  const expectedUndoDepth = before.history.undoDepth + (direction === 'undo' ? -1 : 1);
  await window.keyboard.press(direction === 'undo' ? 'Control+z' : 'Control+Shift+z');
  await window.waitForFunction(({ documentId, expectedUndoDepth }) =>
    window.__lightTableAutomation?.queryDocument(documentId)?.history.undoDepth === expectedUndoDepth,
  { documentId, expectedUndoDepth }, { timeout: 15_000 });
};

const strictRenderPolicy = {
  maximumRmse: 0,
  maximumMeanAbsoluteError: 0,
  maximumChannelRmse: 0,
  maximumChannelMeanAbsoluteError: 0,
  maximumP95PixelDelta: 0,
  maximumChangedPixelRatioAt16: 0
};

try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture,
      LIGHTTABLE_AUTOMATION_SAVE_FILE: uiExportPath
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory: output, sourceFile: fixture,
    pageErrors, label: 'route-equivalence'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(window, 'route-equivalence');
  const mcp = await mcpSession.pairAndAuthorize(window);
  const waitForRecorded = (command, count = 1) => window.waitForFunction(({ command, count }) =>
    window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
      .filter((step) => step.command === command).length >= count,
  { command, count }, { timeout: 30_000 });

  const uiDocumentId = await createDocument(driver, 'UI route');
  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();

  await window.getByRole('button', { name: 'Rectangle (U)', exact: true }).first().click();
  await window.getByRole('button', { name: 'Fill paint', exact: true }).click();
  await window.getByRole('dialog', { name: 'Fill paint options' })
    .getByRole('textbox', { name: 'Hex color' }).fill('#2458d3');
  await window.getByRole('button', { name: 'Close fill paint' }).click();
  await window.getByRole('button', { name: 'Line paint', exact: true }).click();
  const linePaint = window.getByRole('dialog', { name: 'Line paint options' });
  await linePaint.getByRole('radio', { name: 'Color' }).click().catch(() => undefined);
  await linePaint.getByRole('textbox', { name: 'Hex color' }).fill('#f4c542');
  await window.getByRole('button', { name: 'Close line paint' }).click();
  const weight = window.getByRole('spinbutton', { name: 'Weight' });
  if (await weight.count()) await weight.fill('12');

  const viewport = window.locator('.lighttable-viewport:visible').last();
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Canvas viewport is not measurable.');
  await window.mouse.move(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.24);
  await window.mouse.down();
  await window.mouse.move(bounds.x + bounds.width * 0.54, bounds.y + bounds.height * 0.58, { steps: 16 });
  await window.mouse.up();
  await waitForRecorded('vector.create');

  await window.keyboard.press('Control+t');
  const transformBody = window.getByLabel('Transform controls').locator('.lighttable-transform__body');
  const transformBounds = await transformBody.boundingBox();
  if (!transformBounds) throw new Error('Shape transform body is not measurable.');
  await window.mouse.move(transformBounds.x + transformBounds.width / 2,
    transformBounds.y + transformBounds.height / 2);
  await window.mouse.down();
  await window.mouse.move(transformBounds.x + transformBounds.width / 2 + 22,
    transformBounds.y + transformBounds.height / 2 + 14, { steps: 10 });
  await window.mouse.up();
  await window.keyboard.press('Enter');
  await waitForRecorded('layer.setTransform');
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Rename Layer' }).click();
  const layerName = window.locator('input[aria-label="Layer name"]:focus');
  await layerName.fill('Agent card');
  await layerName.press('Enter');

  await window.getByRole('button', { name: 'Type tool (T)', exact: true }).first().click();
  await window.mouse.click(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.72);
  const textInput = window.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached' });
  await textInput.press('Escape');
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await waitForRecorded('text.create')
    .catch(async () => {
      throw new Error(`Text creation did not publish: ${JSON.stringify({
        recording: await driver.queryActionRecording(),
        layers: await driver.queryLayers(uiDocumentId),
        activeDocumentId: (await driver.queryWorkspace())?.activeDocumentId,
        textInputs: await window.getByRole('textbox', { name: /^Edit / }).count()
      })}`);
    });
  await window.getByRole('tab', { name: 'Properties', exact: true }).click();
  await window.getByRole('complementary', { name: 'Text properties' })
    .getByRole('checkbox', { name: 'Bold', exact: true }).click();
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await waitForRecorded('text.format');
  await window.getByRole('menuitem', { name: 'File' }).click();
  await window.getByRole('menuitem', { name: 'Export PNG', exact: true }).click();
  await waitForRecorded('file.exportPng');
  await window.waitForFunction(() => {
    const step = window.__lightTableAutomation?.actionRecordingSnapshot?.().steps
      .find((candidate) => candidate.command === 'file.exportPng');
    return step?.outcome === 'accepted' && step.result?.artifact?.mediaType === 'image/png'
      && step.result.artifact.byteLength > 0;
  }, undefined, { timeout: 60_000 });
  await recorder.getByRole('button', { name: 'Stop' }).click();

  const recording = await driver.queryActionRecording();
  const commands = recording.steps.filter(({ replayable }) => replayable).map(({ command }) => command);
  for (const command of [
    'vector.create', 'layer.setTransform', 'layer.rename', 'text.create', 'text.format', 'file.exportPng'
  ]) {
    assert.ok(commands.includes(command), `UI recording omitted ${command}: ${commands.join(', ')}`);
  }
  const exportStep = recording.steps.find(({ command }) => command === 'file.exportPng');
  assert.equal(exportStep.result.artifact.mediaType, 'image/png');
  assert.ok(exportStep.result.artifact.byteLength > 0, 'UI export artifact was empty.');
  await access(uiExportPath);
  const formatStep = recording.steps.find(({ command }) => command === 'text.format');
  assert.ok(formatStep.parameters.layerId?.$lighttableResult,
    'Recorded text formatting did not bind to the generated text layer.');
  const uiUndoRedo = await assertUndoRedoRoundtrip({
    route: 'UI', readState: () => collectDriverState(driver, uiDocumentId),
    undo: () => keyboardHistory(window, driver, uiDocumentId, 'undo'),
    redo: () => keyboardHistory(window, driver, uiDocumentId, 'redo')
  });
  const expectedUndoDepth = (await driver.queryDocument(uiDocumentId)).history.undoDepth;

  const actionsDocumentId = await createDocumentThroughMcp(mcp, driver, 'Actions route');
  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await window.waitForFunction(({ documentId, undoDepth }) => {
    const automation = window.__lightTableAutomation;
    return automation?.queryLayers(documentId)?.length === 3
      && automation.queryDocument(documentId)?.history.undoDepth === undoDepth;
  }, { documentId: actionsDocumentId, undoDepth: expectedUndoDepth }, { timeout: 60_000 });
  if (!await window.getByRole('complementary', { name: 'Actions' }).count()) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 10_000 });
  const actionsUndoRedo = await assertUndoRedoRoundtrip({
    route: 'Actions', readState: () => collectDriverState(driver, actionsDocumentId),
    undo: () => keyboardHistory(window, driver, actionsDocumentId, 'undo'),
    redo: () => keyboardHistory(window, driver, actionsDocumentId, 'redo')
  });

  const mcpDocumentId = await createDocumentThroughMcp(mcp, driver, 'MCP route');
  const mcpResults = new Map();
  let mcpExportTask = null;
  for (const step of recording.steps.filter(({ replayable }) => replayable)) {
    const before = mcpResult(await mcp.callTool({
      name: 'lighttable_document', arguments: { documentId: mcpDocumentId }
    }), `MCP revision before ${step.command}`);
    const parameters = resolveRecordedParameters(step.parameters, mcpResults);
    const executed = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
      documentId: mcpDocumentId,
      command: step.command,
      expectedDocumentRevision: before.canonicalRevision,
      parameters
    } }), `MCP execute ${step.command}`);
    assert.notEqual(executed.status, 'rejected', `MCP rejected ${step.command}: ${executed.message}`);
    if (executed.status === 'accepted') {
      await window.waitForTimeout(25);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const task = mcpResult(await mcp.callTool({ name: 'lighttable_task', arguments: {
          documentId: mcpDocumentId, taskId: executed.taskId
        } }), `MCP task ${executed.taskId}`);
        if (task?.status === 'failed' || task?.status === 'canceled') {
          throw new Error(`MCP ${step.command} task ${task.status}: ${task.error ?? 'unknown error'}`);
        }
        if (task?.status === 'completed') {
          mcpExportTask = task;
          break;
        }
        await window.waitForTimeout(25);
      }
      assert.equal(mcpExportTask?.artifact?.mediaType, 'image/png');
      assert.ok(mcpExportTask?.artifact?.byteLength > 0, 'MCP export artifact was empty.');
    }
    mcpResults.set(step.sequence, executed.value ?? executed.task ?? executed);
  }
  const mcpUndoRedo = await assertUndoRedoRoundtrip({
    route: 'MCP', readState: () => collectMcpState(mcp, mcpDocumentId),
    undo: async () => mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
      documentId: mcpDocumentId, command: 'history.undo', parameters: {}
    } }), 'MCP Undo'),
    redo: async () => mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
      documentId: mcpDocumentId, command: 'history.redo', parameters: {}
    } }), 'MCP Redo')
  });

  const normalizedStates = {
    ui: normalizeRouteState(await collectDriverState(driver, uiDocumentId)),
    actions: normalizeRouteState(await collectDriverState(driver, actionsDocumentId)),
    mcp: normalizeRouteState(await collectMcpState(mcp, mcpDocumentId))
  };
  assertEquivalentRouteStates(normalizedStates);

  const previewPaths = Object.fromEntries(['ui', 'actions', 'mcp'].map((route) =>
    [route, path.join(output, `${route}.png`)]));
  await writeDriverPreview(driver, uiDocumentId, previewPaths.ui);
  await writeDriverPreview(driver, actionsDocumentId, previewPaths.actions);
  const mcpDocument = mcpResult(await mcp.callTool({
    name: 'lighttable_document', arguments: { documentId: mcpDocumentId }
  }), 'MCP final revision');
  const mcpPreview = await mcp.callTool({ name: 'lighttable_preview', arguments: {
    documentId: mcpDocumentId,
    expectedDocumentRevision: mcpDocument.canonicalRevision,
    maxEdge: 640
  } });
  const mcpImage = mcpPreview.content?.find(({ type }) => type === 'image');
  if (!mcpImage?.data) throw new Error('MCP preview returned no image.');
  await writeFile(previewPaths.mcp, Buffer.from(mcpImage.data, 'base64'));

  const renderEvidence = {};
  renderEvidence['ui-file-export-vs-preview'] = await compareRenderEvidence({
    leftPath: uiExportPath,
    rightPath: previewPaths.ui,
    width: 640,
    height: 480,
    sideBySidePath: path.join(output, 'ui-file-export-vs-preview.png'),
    differencePath: path.join(output, 'ui-file-export-vs-preview-difference-x4.png'),
    policy: strictRenderPolicy
  });
  assert.ok(renderEvidence['ui-file-export-vs-preview'].passed,
    'Delivered File > Export PNG pixels diverged from the canonical UI preview.');
  for (const route of ['actions', 'mcp']) {
    renderEvidence[`ui-vs-${route}`] = await compareRenderEvidence({
      leftPath: previewPaths.ui,
      rightPath: previewPaths[route],
      width: 640,
      height: 480,
      sideBySidePath: path.join(output, `ui-vs-${route}.png`),
      differencePath: path.join(output, `ui-vs-${route}-difference-x4.png`),
      policy: strictRenderPolicy
    });
    assert.ok(renderEvidence[`ui-vs-${route}`].passed, `UI and ${route} pixels diverged.`);
  }
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({
    claim: 'one bounded shape/text workflow only; not whole-application equivalence',
    commands,
    resultBinding: formatStep.parameters.layerId,
    undoRedo: { ui: uiUndoRedo, actions: actionsUndoRedo, mcp: mcpUndoRedo },
    states: normalizedStates,
    renderEvidence,
    exportEvidence: {
      ui: exportStep.result,
      actions: 'playback completed; export steps require a completed task artifact',
      mcp: mcpExportTask,
      deliveredUiFile: uiExportPath
    }
  }, null, 2));
  if (pageErrors.length) throw new Error(`Packaged page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Packaged UI/Actions/MCP route equivalence passed: ${output}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await mcpSession.close().catch(() => undefined);
}
