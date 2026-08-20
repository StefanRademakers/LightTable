import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const evidenceDirectory = path.join(root, 'tmp', 'actions-panel-smoke');
const launch = await resolveDesktopTestLaunch(root);
await Promise.all([access(fixture), mkdir(evidenceDirectory, { recursive: true })]);
const userData = await mkdtemp(path.join(evidenceDirectory, 'profile-'));
const screenshot = path.join(evidenceDirectory, 'actions-panel.png');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

let app;
const pageErrors = [];
try {
  app = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: root,
    env: {
      ...environment,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture
    },
    timeout: 30_000
  });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  const open = await waitForDesktopLauncher({
    app, page: window, outputDirectory: evidenceDirectory,
    sourceFile: fixture, pageErrors, label: 'actions-panel'
  });
  await open.click();
  await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });

  await window.getByRole('menuitem', { name: 'View' }).click();
  await window.getByRole('menuitem', { name: 'Actions panel' }).click();
  const panel = window.getByRole('complementary', { name: 'Actions' });
  await panel.getByRole('radio', { name: 'Actions' }).waitFor();
  const recorder = panel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();
  await recorder.getByText('recording', { exact: true }).waitFor();

  await window.keyboard.press('Control+t');
  const transformOverlay = window.getByLabel('Transform controls');
  await transformOverlay.waitFor({ state: 'visible', timeout: 30_000 });
  const transformBody = transformOverlay.locator('.lighttable-transform__body');
  const transformBounds = await transformBody.boundingBox();
  if (!transformBounds) throw new Error('Actions smoke could not measure the transform body.');
  const transformStart = await window.evaluate(({ x, y, width, height }) => {
    for (const fy of [0.25, 0.5, 0.75]) {
      for (const fx of [0.25, 0.5, 0.75]) {
        const point = { x: x + width * fx, y: y + height * fy };
        if (document.elementFromPoint(point.x, point.y)?.classList.contains('lighttable-transform__body')) {
          return point;
        }
      }
    }
    return null;
  }, transformBounds);
  if (!transformStart) throw new Error('Actions smoke transform body is covered by panel chrome.');
  await window.mouse.move(transformStart.x, transformStart.y);
  await window.mouse.down();
  await window.mouse.move(transformStart.x + 18, transformStart.y + 12, { steps: 8 });
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'layer.setTransform' }).waitFor();
  await window.keyboard.press('Enter');

  const viewport = window.locator('.lighttable-viewport');
  const viewportBounds = await viewport.boundingBox();
  if (!viewportBounds) throw new Error('Actions smoke could not measure the canvas viewport.');
  await window.keyboard.press('m');
  await window.locator('.lighttable-tool-options__identity')
    .filter({ hasText: 'Rectangular selection' }).waitFor();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.3,
    viewportBounds.y + viewportBounds.height * 0.3
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.55,
    viewportBounds.y + viewportBounds.height * 0.55,
    { steps: 12 }
  );
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'selection.applyShape' }).waitFor();
  await window.getByRole('menuitem', { name: 'Select' }).click();
  await window.getByRole('menuitem', { name: 'Inverse' }).click();
  await recorder.locator('li').filter({ hasText: 'selection.modify' }).waitFor();

  const layerRows = window.getByRole('treeitem');
  const before = await layerRows.count();
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'New Raster Layer' }).click();
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before + 1
  );
  await recorder.locator('li').filter({ hasText: 'layer.createRaster' }).waitFor();
  await window.keyboard.press('b');
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.18,
    viewportBounds.y + viewportBounds.height * 0.32
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.38,
    viewportBounds.y + viewportBounds.height * 0.58,
    { steps: 24 }
  );
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'tool.commitGesture' }).waitFor();
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Rename Layer' }).click();
  const focusedLayerName = window.locator('input[aria-label="Layer name"]:focus');
  await focusedLayerName.fill('Recorded Title');
  await focusedLayerName.press('Enter');
  await recorder.locator('li').filter({ hasText: 'layer.rename' }).waitFor();
  await window.getByRole('tab', { name: 'Properties', exact: true }).click();
  const exposure = window.getByRole('slider', { name: 'Exposure', exact: true });
  await exposure.focus();
  await exposure.press('ArrowRight');
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'grade.setBasic' }).waitFor();

  const typeTool = window.getByRole('button', { name: 'Type tool (T)', exact: true }).first();
  await typeTool.click();
  await typeTool.waitFor();
  await window.mouse.click(
    viewportBounds.x + viewportBounds.width * 0.62,
    viewportBounds.y + viewportBounds.height * 0.28
  );
  const textInput = window.getByRole('textbox', { name: /^Edit / });
  await textInput.waitFor({ state: 'attached', timeout: 30_000 });
  await textInput.press('Escape');
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'text.create' }).waitFor({ timeout: 30_000 });
  await window.getByRole('tab', { name: 'Properties', exact: true }).click();
  const textProperties = window.getByRole('complementary', { name: 'Text properties' });
  await textProperties.waitFor();
  await textProperties.getByRole('checkbox', { name: 'Bold', exact: true }).click();
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'text.format' }).waitFor();

  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Layer Mask' }).hover();
  await window.getByRole('menuitem', { name: 'Add Layer Mask' }).click();
  await recorder.locator('li').filter({ hasText: 'layer.setMask' }).waitFor();
  await window.getByRole('menuitem', { name: 'Layer' }).click();
  await window.getByRole('menuitem', { name: 'Layer Mask' }).hover();
  await window.getByRole('menuitem', { name: 'Disable Layer Mask' }).click();
  if (await recorder.locator('li').filter({ hasText: 'layer.setMask' }).count() !== 2) {
    throw new Error('Expected add and disable layer-mask Action steps.');
  }

  await window.getByRole('button', { name: 'Rectangle (U)', exact: true }).first().click();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.18,
    viewportBounds.y + viewportBounds.height * 0.62
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.36,
    viewportBounds.y + viewportBounds.height * 0.78,
    { steps: 16 }
  );
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'vector.create' }).waitFor({ timeout: 15_000 })
    .catch(async () => {
      const diagnostic = await window.evaluate(() => {
        const driver = window.__lightTableAutomation;
        const workspace = driver?.queryWorkspace();
        const documentId = workspace?.activeDocumentId;
        return { document: documentId ? driver?.queryDocument(documentId) : null,
          layers: documentId ? driver?.queryLayers(documentId) : null };
      });
      throw new Error(`Native Rectangle did not record vector.create: ${JSON.stringify({
        diagnostic, recorder: await recorder.textContent()
      })}`);
    });

  await window.keyboard.press('p');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Pen' }).waitFor();
  for (const [x, y] of [[0.18, 0.2], [0.34, 0.32], [0.22, 0.48]]) {
    await window.mouse.click(
      viewportBounds.x + viewportBounds.width * x,
      viewportBounds.y + viewportBounds.height * y
    );
  }
  await window.keyboard.press('Enter');
  await window.waitForFunction(() => {
    const recorder = document.querySelector('.lighttable-action-recorder');
    return recorder && [...recorder.querySelectorAll('li')]
      .filter((entry) => entry.textContent?.includes('vector.create')).length === 2;
  }, undefined, { timeout: 15_000 });

  await window.keyboard.press('Shift+a');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Direct selection' }).waitFor();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.18,
    viewportBounds.y + viewportBounds.height * 0.2
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.21,
    viewportBounds.y + viewportBounds.height * 0.23,
    { steps: 12 }
  );
  await window.mouse.up();
  await recorder.locator('li').filter({ hasText: 'vector.update' }).waitFor({ timeout: 15_000 });

  await window.keyboard.press('g');
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Gradient' }).waitFor();
  const gradientApplication = window.getByRole('combobox', { name: 'Gradient application' });
  await gradientApplication.selectOption('fill-layer');
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.14,
    viewportBounds.y + viewportBounds.height * 0.2
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.37,
    viewportBounds.y + viewportBounds.height * 0.42,
    { steps: 14 }
  );
  await window.mouse.up();
  await window.waitForFunction(() => {
    const entries = [...document.querySelectorAll('.lighttable-action-recorder li')];
    return entries.filter((entry) => entry.textContent?.includes('vector.create')).length >= 3;
  }, undefined, { timeout: 15_000 }).catch(async () => {
    throw new Error(`Gradient Fill did not record vector.create: ${await recorder.textContent()}`);
  });
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.255,
    viewportBounds.y + viewportBounds.height * 0.31
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.285,
    viewportBounds.y + viewportBounds.height * 0.37,
    { steps: 10 }
  );
  await window.mouse.up();
  await window.waitForFunction(() => {
    const entries = [...document.querySelectorAll('.lighttable-action-recorder li')];
    return entries.filter((entry) => entry.textContent?.includes('vector.update')).length >= 2;
  }, undefined, { timeout: 15_000 });

  // Warp stays on the real pointer path while recording. Only each completed,
  // layer-source recipe crosses the Actions boundary.
  await window.getByRole('treeitem', { name: /Recorded Title/i }).click();
  const warpTelemetryBefore = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    if (documentId) driver?.resetRenderTelemetry?.(documentId);
    return documentId ? driver?.queryDocument(documentId) : null;
  });
  await window.getByRole('button', { name: 'Warp', exact: true }).click();
  await window.locator('.lighttable-tool-options__identity').filter({ hasText: 'Warp' }).waitFor();
  const warpMode = window.locator('label.lighttable-tool-options__field')
    .filter({ hasText: /^Mode/ }).locator('select');
  await warpMode.selectOption('push');
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.2,
    viewportBounds.y + viewportBounds.height * 0.42
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.34,
    viewportBounds.y + viewportBounds.height * 0.48,
    { steps: 16 }
  );
  await window.mouse.up();
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'warp.applyStroke' }).waitFor({ timeout: 15_000 })
    .catch(async () => {
      const diagnostic = await window.evaluate(() => {
        const driver = window.__lightTableAutomation;
        const workspace = driver?.queryWorkspace();
        const documentId = workspace?.activeDocumentId;
        const documentState = documentId ? driver?.queryDocument(documentId) : null;
        const layers = documentId ? driver?.queryLayers(documentId) : null;
        const active = layers?.find(({ id }) => id === documentState?.activeLayerId);
        return { documentState, active,
          warp: documentId && active ? driver?.queryWarp?.(documentId, active.id) : null };
      });
      throw new Error(`Native Warp did not record warp.applyStroke: ${JSON.stringify({
        diagnostic, recorder: await recorder.textContent()
      })}`);
    });
  await warpMode.selectOption('twirl-cw');
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.29,
    viewportBounds.y + viewportBounds.height * 0.36
  );
  await window.mouse.down();
  await window.waitForTimeout(180);
  await window.mouse.up();
  await window.waitForFunction(() => [...document.querySelectorAll('.lighttable-action-recorder li')]
    .filter((entry) => entry.textContent?.includes('warp.applyStroke')).length === 2,
  undefined, { timeout: 15_000 });
  const warpRecordingEvidence = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const workspace = driver?.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    const layer = documentId ? driver?.queryLayers(documentId)?.find(({ name }) => name === 'Recorded Title') : null;
    const warp = documentId && layer ? driver?.queryWarp?.(documentId, layer.id) : null;
    const telemetry = documentId ? driver?.queryRenderTelemetry?.(documentId) : null;
    return { warp, telemetry, document: documentId ? driver?.queryDocument(documentId) : null,
      recipeBytes: warp ? new TextEncoder().encode(JSON.stringify(warp.strokes)).byteLength : null };
  });
  if (warpRecordingEvidence.warp?.totalStrokes !== 2
    || warpRecordingEvidence.warp?.strokes?.[0]?.mode !== 'push'
    || warpRecordingEvidence.warp?.strokes?.[1]?.mode !== 'twirl-cw'
    || warpRecordingEvidence.document?.history.undoDepth !== warpTelemetryBefore?.history.undoDepth + 2) {
    throw new Error(`Warp recording did not publish two semantic history commits: ${JSON.stringify(warpRecordingEvidence)}`);
  }
  await window.getByRole('button', { name: 'Show gradient and fill tools', exact: true }).click();
  await window.getByRole('button', { name: 'Paint bucket (G)', exact: true }).click();
  await window.mouse.click(
    viewportBounds.x + viewportBounds.width * 0.24,
    viewportBounds.y + viewportBounds.height * 0.44
  );
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'raster.fill' }).waitFor({ timeout: 15_000 });
  await window.getByRole('button', { name: 'Show gradient and fill tools', exact: true }).click();
  await window.getByRole('button', { name: 'Gradient (G)', exact: true }).click();
  await window.getByRole('combobox', { name: 'Gradient application' }).selectOption('pixels');
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.19,
    viewportBounds.y + viewportBounds.height * 0.58
  );
  await window.mouse.down();
  await window.mouse.move(
    viewportBounds.x + viewportBounds.width * 0.39,
    viewportBounds.y + viewportBounds.height * 0.66,
    { steps: 18 }
  );
  if (await recorder.locator('li').filter({ hasText: 'raster.applyGradient' }).count() !== 0) {
    throw new Error('Raster Gradient published before pointer-up.');
  }
  await window.mouse.up();
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.locator('li').filter({ hasText: 'raster.applyGradient' }).waitFor({ timeout: 15_000 });

  await panel.getByRole('radio', { name: 'Commands' }).click();
  await panel.getByText(/commands$/).waitFor();
  for (let index = 0; index < 20; index += 1) {
    await window.getByRole('tab', { name: 'Actions', exact: true }).click();
    await panel.getByRole('radio', { name: 'Commands' }).click();
    const undo = panel.locator('details').filter({ hasText: 'history.undo' });
    const undoButton = undo.getByRole('button', { name: 'Run' });
    if (!await undoButton.isVisible()) await undo.locator('summary').click();
    await undoButton.waitFor();
    const beforeUndoDepth = await window.evaluate(() => {
      const driver = window.__lightTableAutomation;
      const documentId = driver?.queryWorkspace()?.activeDocumentId;
      return documentId ? driver?.queryDocument(documentId)?.history.undoDepth : null;
    });
    await undoButton.click();
    await window.waitForFunction((expected) => {
      const driver = window.__lightTableAutomation;
      const documentId = driver?.queryWorkspace()?.activeDocumentId;
      return documentId && driver?.queryDocument(documentId)?.history.undoDepth === expected;
    }, Number(beforeUndoDepth) - 1, { timeout: 15_000 });
  }
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before
  );
  await panel.getByRole('radio', { name: 'Actions' }).click();
  const undoSteps = recorder.locator('li').filter({ hasText: 'history.undo' });
  await undoSteps.first().waitFor();
  if (await undoSteps.count() !== 20) throw new Error('Expected twenty recorded Undo diagnostics.');
  const undoStep = undoSteps.first();
  await undoStep.locator('summary').click();
  await undoStep.getByText('Replayable').waitFor();
  await undoStep.getByText('no', { exact: true }).waitFor();
  const renameStep = recorder.locator('li').filter({ hasText: 'layer.rename' });
  await renameStep.locator('summary').click();
  await renameStep.getByText('$step4.layerId', { exact: false }).waitFor();
  const brushStep = recorder.locator('li').filter({ hasText: 'tool.commitGesture' });
  await brushStep.locator('summary').click();
  await brushStep.getByText('$step4.layerId', { exact: false }).waitFor();
  const gradeStep = recorder.locator('li').filter({ hasText: 'grade.setBasic' });
  await gradeStep.locator('summary').click();
  const gradeStepText = await gradeStep.textContent();
  if (!gradeStepText?.includes('$step6.layerId')) {
    throw new Error(`Recorded Grade target was not rebound to the latest layer result: ${gradeStepText}`);
  }
  const textFormatStep = recorder.locator('li').filter({ hasText: 'text.format' });
  await textFormatStep.locator('summary').click();
  const textFormatStepText = await textFormatStep.textContent();
  if (!textFormatStepText?.includes('$step8.layerId')) {
    throw new Error(`Recorded text format target was not bound to text.create: ${textFormatStepText}`);
  }
  const vectorCreateSteps = recorder.locator('li').filter({ hasText: 'vector.create' });
  const penStep = vectorCreateSteps.nth(1);
  await penStep.locator('summary').click();
  const penStepText = await penStep.textContent();
  if (!penStepText?.includes('$step12.layerId')) {
    throw new Error(`Recorded Pen path was not bound to Rectangle layer result: ${penStepText}`);
  }
  const vectorUpdateSteps = recorder.locator('li').filter({ hasText: 'vector.update' });
  const vectorUpdateStep = vectorUpdateSteps.first();
  await vectorUpdateStep.locator('summary').click();
  const vectorUpdateText = await vectorUpdateStep.textContent();
  if (!vectorUpdateText?.includes('$step13.layerId')
    || !vectorUpdateText.includes('$step13.elementId')) {
    throw new Error(`Recorded Direct Selection edit was not bound to its Pen path: ${vectorUpdateText}`);
  }
  const gradientCreateStep = vectorCreateSteps.nth(2);
  await gradientCreateStep.locator('summary').click();
  const gradientCreateText = await gradientCreateStep.textContent();
  if (!gradientCreateText?.includes('gradient-fill')) {
    throw new Error(`Recorded Gradient Fill lost its layer role: ${gradientCreateText}`);
  }
  const gradientUpdateStep = vectorUpdateSteps.nth(1);
  await gradientUpdateStep.locator('summary').click();
  const gradientUpdateText = await gradientUpdateStep.textContent();
  if (!gradientUpdateText?.includes('$step15.layerId')
    || !gradientUpdateText.includes('$step15.elementId')) {
    throw new Error(`Recorded Gradient edit was not bound to its fill layer: ${gradientUpdateText}`);
  }
  const warpSteps = recorder.locator('li').filter({ hasText: 'warp.applyStroke' });
  if (await warpSteps.count() !== 2) throw new Error('Expected push and held Warp Action steps.');
  await warpSteps.first().locator('summary').click();
  const firstWarpText = await warpSteps.first().textContent();
  await warpSteps.nth(1).locator('summary').click();
  const secondWarpText = await warpSteps.nth(1).textContent();
  if (!firstWarpText?.includes('$step7.target.layerId') || !secondWarpText?.includes('$step17.layerId')) {
    throw new Error(`Warp bindings are not stable across replay: ${JSON.stringify({ firstWarpText, secondWarpText })}`);
  }
  const fillStep = recorder.locator('li').filter({ hasText: 'raster.fill' });
  await fillStep.locator('summary').click();
  const fillStepText = await fillStep.textContent();
  if (!fillStepText?.includes('$step18.layerId') || !fillStepText.includes('"channel": "pixels"')) {
    throw new Error(`Recorded Fill target/channel are not stable: ${fillStepText}`);
  }
  const rasterGradientStep = recorder.locator('li').filter({ hasText: 'raster.applyGradient' });
  await rasterGradientStep.locator('summary').click();
  const rasterGradientText = await rasterGradientStep.textContent();
  if (!rasterGradientText?.includes('$step19.layerId')
    || !rasterGradientText.includes('"coordinateSpace": "document"')) {
    throw new Error(`Recorded raster Gradient lost target or final paint: ${rasterGradientText}`);
  }
  await recorder.getByRole('button', { name: 'Stop' }).click();
  await recorder.getByText('stopped', { exact: true }).waitFor();
  await recorder.getByRole('button', { name: 'Play', exact: true }).click();
  await window.waitForFunction(
    (expected) => document.querySelectorAll('[role="treeitem"]').length === expected,
    before + 4,
    { timeout: 15_000 }
  );
  await window.getByRole('tab', { name: 'Actions', exact: true }).click();
  await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
    .waitFor({ timeout: 15_000 }).catch(async () => {
      throw new Error(`Actions playback did not complete: ${await recorder.textContent()}`);
    });
  await window.waitForFunction(
    (expected) => [...document.querySelectorAll('input[aria-label="Layer name"]')]
      .some((input) => input.value === expected),
    'Recorded Title',
    { timeout: 15_000 }
  );
  await window.locator('.lighttable-layer__text-status', { hasText: 'Flow' })
    .waitFor({ state: 'visible', timeout: 15_000 });
  const playbackText = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const workspace = driver?.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    const textLayer = documentId
      ? driver?.queryLayers(documentId)?.find(({ type }) => type === 'text')
      : null;
    return documentId && textLayer
      ? driver?.queryText(documentId, textLayer.id)
      : null;
  });
  if (playbackText?.sourceKind !== 'flow' || !playbackText.editable
    || playbackText.styleRuns?.[0]?.syntheticBold !== true
    || typeof playbackText.transform?.tx !== 'number'
    || typeof playbackText.transform?.ty !== 'number') {
    throw new Error(`Actions replay did not preserve editable faux-bold text: ${JSON.stringify(playbackText)}`);
  }
  const playbackMask = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const workspace = driver?.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    return documentId
      ? driver?.queryLayers(documentId)?.find(({ type, hasMask }) => type === 'text' && hasMask)
      : null;
  });
  if (!playbackMask?.hasMask || playbackMask.maskContent?.raster?.enabled !== false) {
    throw new Error(`Actions replay did not preserve disabled layer mask: ${JSON.stringify(playbackMask)}`);
  }
  const playbackShape = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const workspace = driver?.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    const shapeLayer = documentId
      ? driver?.queryLayers(documentId)?.find(({ type, name, vectorRole }) => (
          type === 'vector' && name === 'Shape' && vectorRole === 'artwork'
        ))
      : null;
    return documentId && shapeLayer ? {
      layerName: shapeLayer.name,
      vector: driver?.queryVector(documentId, shapeLayer.id)
    } : null;
  });
  const rectangle = playbackShape?.vector?.elements?.find(({ type }) => type === 'live-shape');
  const penPath = playbackShape?.vector?.elements?.find(({ type }) => type === 'path');
  if (playbackShape?.layerName !== 'Shape'
    || playbackShape.vector?.totalElements !== 2
    || rectangle?.geometry?.kind !== 'rectangle'
    || penPath?.subpaths?.[0]?.anchors?.length !== 3) {
    throw new Error(`Actions replay did not preserve native Rectangle and Pen path: ${JSON.stringify(playbackShape)}`);
  }
  const playbackGradient = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const workspace = driver?.queryWorkspace();
    const documentId = workspace?.activeDocumentId;
    const gradientLayer = documentId
      ? driver?.queryLayers(documentId)?.find(({ vectorRole }) => vectorRole === 'gradient-fill')
      : null;
    return documentId && gradientLayer ? {
      layer: gradientLayer,
      vector: driver?.queryVector(documentId, gradientLayer.id)
    } : null;
  });
  const gradientShape = playbackGradient?.vector?.elements?.[0];
  if (playbackGradient?.layer?.vectorRole !== 'gradient-fill'
    || gradientShape?.type !== 'live-shape'
    || gradientShape.style?.fill?.kind !== 'gradient') {
    throw new Error(`Actions replay did not preserve editable Gradient Fill: ${JSON.stringify(playbackGradient)}`);
  }
  const playbackWarp = await window.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    const layer = documentId ? driver?.queryLayers(documentId)?.find(({ name }) => name === 'Recorded Title') : null;
    return documentId && layer ? driver?.queryWarp?.(documentId, layer.id) : null;
  });
  if (playbackWarp?.totalStrokes !== 2 || playbackWarp.totalSamples < 3
    || playbackWarp.strokes?.[0]?.mode !== 'push'
    || playbackWarp.strokes?.[1]?.mode !== 'twirl-cw') {
    throw new Error(`Actions replay did not preserve editable Warp recipes: ${JSON.stringify(playbackWarp)}`);
  }
  process.stdout.write(`Warp Actions evidence: ${JSON.stringify({
    historyEntries: 2,
    semanticOperations: 2,
    samples: warpRecordingEvidence.warp.totalSamples,
    recipeBytes: warpRecordingEvidence.recipeBytes,
    submittedFrames: warpRecordingEvidence.telemetry?.submittedFrames ?? null
  })}\n`);

  await window.screenshot({ path: screenshot });
  if (pageErrors.length) throw new Error(`Actions panel page errors: ${pageErrors.join(' | ')}`);
  process.stdout.write(`Desktop Actions panel smoke passed: ${screenshot}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
