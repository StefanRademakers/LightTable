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
let workflowPhase = 'launch';
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
const highFrequencyText = 'Agent native typing remains local. '.repeat(6);
const composedText = '編集🧪';

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
  window.on('pageerror', (error) => pageErrors.push(
    `[${workflowPhase}] ${error.stack ?? error.message}`
  ));
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

  workflowPhase = 'ui-recording';
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

  workflowPhase = 'ui-transform-shortcut';
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
  workflowPhase = 'ui-transform-commit';
  await window.keyboard.press('Enter');
  await waitForRecorded('layer.setTransform');
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Rename Layer' }).click();
  const layerName = window.locator('input[aria-label="Layer name"]:focus');
  await layerName.fill('Agent card');
  workflowPhase = 'ui-layer-rename';
  await layerName.press('Enter');

  // Exercise another live-shape primitive through the actual toolbar family.
  // All drag samples stay inside the tool controller; only mouse-up publishes
  // the single native vector.create recorded below.
  await window.getByRole('button', { name: 'Show shape tools', exact: true }).click();
  await window.getByRole('toolbar', { name: 'Shape tools' })
    .getByRole('button', { name: 'Ellipse (U)', exact: true }).click();
  await window.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.18);
  await window.mouse.down();
  await window.mouse.move(bounds.x + bounds.width * 0.86, bounds.y + bounds.height * 0.42, { steps: 18 });
  await window.mouse.up();
  await waitForRecorded('vector.create', 2);

  // Pen anchor/rubber-band interaction is likewise local. Enter commits one
  // editable open path rather than publishing per anchor or pointer sample.
  workflowPhase = 'ui-pen-shortcut';
  await window.keyboard.press('p');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Pen' }).waitFor();
  for (const [x, y] of [[0.18, 0.2], [0.34, 0.32], [0.22, 0.48]]) {
    await window.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
  }
  workflowPhase = 'ui-pen-commit';
  await window.keyboard.press('Enter');
  await waitForRecorded('vector.create', 3);

  await window.getByRole('button', { name: 'Type tool (T)', exact: true }).first().click();
  await window.mouse.click(bounds.x + bounds.width * 0.28, bounds.y + bounds.height * 0.72);
  const textInput = window.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached' });
  workflowPhase = 'ui-text-typing';
  await textInput.pressSequentially(highFrequencyText);
  workflowPhase = 'ui-text-composition';
  await textInput.evaluate((input, text) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '編' }));
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
  }, composedText);
  await waitForRecorded('text.replaceRange', 2);
  workflowPhase = 'ui-text-finish';
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
  workflowPhase = 'ui-text-format';
  await window.getByRole('complementary', { name: 'Text properties' })
    .getByRole('checkbox', { name: 'Bold', exact: true }).click();
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await waitForRecorded('text.format');
  workflowPhase = 'ui-export';
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
    'vector.create', 'layer.setTransform', 'layer.rename', 'text.create', 'text.replaceRange',
    'text.format', 'file.exportPng'
  ]) {
    assert.ok(commands.includes(command), `UI recording omitted ${command}: ${commands.join(', ')}`);
  }
  const vectorSteps = recording.steps.filter(({ command }) => command === 'vector.create');
  assert.equal(vectorSteps.length, 3,
    `Rectangle, Ellipse and Pen should each publish one vector.create: ${vectorSteps.length}`);
  assert.equal(vectorSteps[0].parameters.primitive?.kind, 'rectangle');
  assert.equal(vectorSteps[1].parameters.primitive?.kind, 'ellipse');
  assert.equal(vectorSteps[2].parameters.subpaths?.[0]?.anchors?.length, 3,
    'Recorded Pen path did not preserve its three native anchors.');
  const exportStep = recording.steps.find(({ command }) => command === 'file.exportPng');
  assert.equal(exportStep.result.artifact.mediaType, 'image/png');
  assert.ok(exportStep.result.artifact.byteLength > 0, 'UI export artifact was empty.');
  await access(uiExportPath);
  const formatStep = recording.steps.find(({ command }) => command === 'text.format');
  const replacementSteps = recording.steps.filter(({ command }) => command === 'text.replaceRange');
  assert.equal(replacementSteps.length, 2,
    `Typing and IME should publish two commits, not per-input commands: ${replacementSteps.length}`);
  assert.deepEqual(replacementSteps.map(({ parameters }) => parameters.text),
    [highFrequencyText, composedText]);
  for (const step of replacementSteps) {
    assert.ok(step.parameters.layerId?.$lighttableResult,
      'Recorded text replacement did not bind to the generated text layer.');
  }
  assert.ok(formatStep.parameters.layerId?.$lighttableResult,
    'Recorded text formatting did not bind to the generated text layer.');
  workflowPhase = 'ui-undo-redo';
  const uiUndoRedo = await assertUndoRedoRoundtrip({
    route: 'UI', readState: () => collectDriverState(driver, uiDocumentId),
    undo: () => keyboardHistory(window, driver, uiDocumentId, 'undo'),
    redo: () => keyboardHistory(window, driver, uiDocumentId, 'redo')
  });
  const expectedUndoDepth = (await driver.queryDocument(uiDocumentId)).history.undoDepth;
  const expectedLayerCount = (await driver.queryLayers(uiDocumentId)).length;

  workflowPhase = 'actions-playback';
  const actionsDocumentId = await createDocumentThroughMcp(mcp, driver, 'Actions route');
  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await window.waitForFunction(({ documentId, undoDepth, layerCount }) => {
    const automation = window.__lightTableAutomation;
    return automation?.queryLayers(documentId)?.length === layerCount
      && automation.queryDocument(documentId)?.history.undoDepth === undoDepth;
  }, {
    documentId: actionsDocumentId,
    undoDepth: expectedUndoDepth,
    layerCount: expectedLayerCount
  }, { timeout: 60_000 });
  if (!await window.getByRole('complementary', { name: 'Actions' }).count()) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 10_000 });
  workflowPhase = 'actions-undo-redo';
  const actionsUndoRedo = await assertUndoRedoRoundtrip({
    route: 'Actions', readState: () => collectDriverState(driver, actionsDocumentId),
    undo: () => keyboardHistory(window, driver, actionsDocumentId, 'undo'),
    redo: () => keyboardHistory(window, driver, actionsDocumentId, 'redo')
  });

  workflowPhase = 'mcp-playback';
  const mcpDocumentId = await createDocumentThroughMcp(mcp, driver, 'MCP route');
  const mcpEventBaseline = mcpResult(await mcp.callTool({
    name: 'lighttable_events', arguments: { afterCursor: 0, limit: 1 }
  }), 'MCP event baseline');
  const mcpPublicationWait = mcp.callTool({
    name: 'lighttable_wait_for_events', arguments: {
      afterCursor: mcpEventBaseline.latestCursor, limit: 20, timeoutMs: 10_000
    }
  });
  const mcpResults = new Map();
  let mcpExportTask = null;
  let waitedPublications = null;
  let waitedPublicationTail = null;
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
    if (!waitedPublications) {
      waitedPublications = mcpResult(await mcpPublicationWait, 'MCP publication wait');
      assert.equal(waitedPublications.timedOut, false, 'MCP event wait timed out after a real edit.');
      assert.equal(waitedPublications.gap, false, 'MCP event wait reported an unexpected cursor gap.');
      assert.ok(waitedPublications.events.some((event) => event.documentId === mcpDocumentId),
        'MCP event wait woke without an event for the edited document.');
      waitedPublicationTail = mcpResult(await mcp.callTool({
        name: 'lighttable_events', arguments: { afterCursor: waitedPublications.cursor, limit: 20 }
      }), 'MCP publication tail');
      const commandPublications = [...waitedPublications.events, ...waitedPublicationTail.events];
      assert.equal(waitedPublicationTail.gap, false, 'MCP event tail reported an unexpected cursor gap.');
      assert.ok(commandPublications.some((event) =>
        event.kind === 'document-revision-changed' && event.documentId === mcpDocumentId
          && event.detail?.canonicalRevision === executed.revisions?.document),
      `MCP event wait missed the exact revision published by its first edit: ${JSON.stringify({
        executed, waitedPublications, waitedPublicationTail
      })}`);
      assert.ok(commandPublications.some((event) =>
        event.kind === 'history-changed' && event.documentId === mcpDocumentId),
      'MCP event wait missed the history publication from its first edit.');
    }
  }
  workflowPhase = 'mcp-undo-redo';
  const mcpUndoRedo = await assertUndoRedoRoundtrip({
    route: 'MCP', readState: () => collectMcpState(mcp, mcpDocumentId),
    undo: async () => mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
      documentId: mcpDocumentId, command: 'history.undo', parameters: {}
    } }), 'MCP Undo'),
    redo: async () => mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
      documentId: mcpDocumentId, command: 'history.redo', parameters: {}
    } }), 'MCP Redo')
  });

  workflowPhase = 'state-and-render-equivalence';
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

  workflowPhase = 'rejection-equivalence';
  const mcpFailureBeforeRaw = await collectMcpState(mcp, mcpDocumentId);
  const mcpFailureBefore = normalizeRouteState(mcpFailureBeforeRaw);
  const failureRevision = mcpFailureBeforeRaw.document.canonicalRevision;
  const failureLayerId = mcpFailureBeforeRaw.layers.find(({ type }) => type === 'vector')?.id;
  const failureText = mcpFailureBeforeRaw.texts[0];
  if (!failureLayerId || !failureText) throw new Error('Failure proof requires vector and text targets.');
  const staleFailure = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: mcpDocumentId,
    command: 'layer.rename',
    expectedDocumentRevision: failureRevision - 1,
    parameters: { layerId: failureLayerId, name: 'Must not publish' }
  } }), 'MCP stale revision rejection');
  assert.equal(staleFailure.status, 'rejected');
  assert.equal(staleFailure.code, 'stale-document-revision');
  assert.equal(staleFailure.revisions.document, failureRevision);
  const invalidFailure = mcpResult(await mcp.callTool({ name: 'lighttable_execute', arguments: {
    documentId: mcpDocumentId,
    command: 'text.replaceRange',
    expectedDocumentRevision: failureRevision,
    parameters: {
      layerId: failureText.layerId,
      start: failureText.content.totalLength + 1,
      end: failureText.content.totalLength + 1,
      text: 'Must not publish'
    }
  } }), 'MCP invalid text range rejection');
  assert.equal(invalidFailure.status, 'rejected');
  assert.equal(invalidFailure.code, 'invalid-parameters');
  assert.deepEqual(normalizeRouteState(await collectMcpState(mcp, mcpDocumentId)), mcpFailureBefore,
    'Rejected MCP requests changed canonical state or history.');

  workflowPhase = 'actions-failure-playback';
  if (!await window.getByRole('complementary', { name: 'Actions' }).count()) {
    await window.getByRole('menuitem', { name: 'View' }).click();
    await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  }
  await recorder.getByRole('button', { name: 'Clear' }).click();
  await recorder.getByRole('button', { name: 'Record' }).click();
  await window.getByRole('button', { name: 'Type tool (T)', exact: true }).first().click();
  const failureViewport = window.locator('.lighttable-viewport:visible').last();
  const failureBounds = await failureViewport.boundingBox();
  if (!failureBounds) throw new Error('Failure source viewport is not measurable.');
  await window.mouse.click(
    failureBounds.x + failureBounds.width * 0.3,
    failureBounds.y + failureBounds.height * 0.73
  );
  const failureInput = window.getByRole('textbox', { name: /^Edit / });
  await failureInput.waitFor({ state: 'attached' });
  await failureInput.pressSequentially('!');
  await failureInput.press('Escape');
  await waitForRecorded('text.replaceRange');
  await recorder.getByRole('button', { name: 'Stop' }).click();
  const targetFailureRecording = await driver.queryActionRecording();
  assert.equal(targetFailureRecording.steps.length, 1,
    `Target failure recording should contain one edit: ${JSON.stringify(targetFailureRecording.steps)}`);
  const targetFailureStep = targetFailureRecording.steps[0];
  assert.equal(targetFailureStep.command, 'text.replaceRange');
  assert.equal(typeof targetFailureStep.parameters.layerId, 'string',
    'The target failure needs a fixed existing layer ID, not a generated binding.');
  const missingTargetDocumentId = await createDocumentThroughMcp(mcp, driver, 'Actions missing target');
  const actionsFailureBefore = normalizeRouteState(await collectDriverState(driver, missingTargetDocumentId));
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: failed at step 1' })
    .waitFor({ timeout: 30_000 });
  const actionsFailureMessage = (await recorder.locator('.lighttable-action-recorder__steps li').first()
    .locator('.lighttable-action-recorder__warning').textContent())?.trim() ?? '';
  assert.match(actionsFailureMessage, /target text layer does not exist/i);
  assert.deepEqual(normalizeRouteState(await collectDriverState(driver, missingTargetDocumentId)),
    actionsFailureBefore, 'Rejected Actions playback changed canonical state or history.');

  workflowPhase = 'evidence-finalization';
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({
    claim: 'one bounded native vector/text workflow only; not whole-application equivalence',
    commands,
    vectorInputEvidence: {
      primitives: vectorSteps.map(({ parameters }) => parameters.primitive?.kind ?? 'path'),
      penAnchorCount: vectorSteps[2].parameters.subpaths[0].anchors.length,
      semanticCreateCommands: vectorSteps.length,
      transientPointerSamplesPublished: 0
    },
    eventWaitEvidence: {
      afterCursor: mcpEventBaseline.latestCursor,
      timedOut: waitedPublications.timedOut,
      gap: waitedPublications.gap,
      wakeKinds: waitedPublications.events.map(({ kind }) => kind),
      tailKinds: waitedPublicationTail.events.map(({ kind }) => kind)
    },
    textInputEvidence: {
      inputCharacters: highFrequencyText.length,
      compositionUpdates: 2,
      semanticReplacementCommands: replacementSteps.length,
      finalText: `${highFrequencyText}${composedText}`
    },
    resultBinding: formatStep.parameters.layerId,
    undoRedo: { ui: uiUndoRedo, actions: actionsUndoRedo, mcp: mcpUndoRedo },
    states: normalizedStates,
    renderEvidence,
    exportEvidence: {
      ui: exportStep.result,
      actions: 'playback completed; export steps require a completed task artifact',
      mcp: mcpExportTask,
      deliveredUiFile: uiExportPath
    },
    failureEvidence: {
      observedUiValidation: 'invalid observed parameters are refused before revision/recording publication',
      actions: { status: 'failed', sequence: 1, message: actionsFailureMessage,
        stateAndHistoryUnchanged: true },
      mcp: { stale: staleFailure, invalid: invalidFailure, stateAndHistoryUnchanged: true }
    }
  }, null, 2));
  if (pageErrors.length) throw new Error(`Packaged page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Packaged UI/Actions/MCP route equivalence passed: ${output}\n`);
} finally {
  await app?.close().catch(() => undefined);
  await mcpSession.close().catch(() => undefined);
}
