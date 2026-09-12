import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\RandomFiles\\face.jpg');
const interactionMode = process.argv.includes('--subject') ? 'subject'
  : process.argv.includes('--rectangle') ? 'rectangle' : 'object-finder';
const refineNegative = process.argv.includes('--negative');
const lifetimeMode = process.argv.includes('--lifetime');
const optionValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const caseName = optionValue('--case', path.parse(sourceFile).name).replace(/[^a-z0-9_-]+/gi, '-');
const backendProfile = optionValue('--backend', 'balanced');
const clickXRatio = Number(optionValue('--x', '0.68'));
const clickYRatio = Number(optionValue('--y', '0.4'));
const inferenceTimeoutMs = Number(optionValue('--inference-timeout', '45000'));
const outputDirectory = path.join(workspaceRoot, 'tmp', 'object-selection-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, `${caseName}-committed.png`);
const reportPath = path.join(outputDirectory, `${caseName}-report.json`);

if (![clickXRatio, clickYRatio].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
  throw new Error('Object Selection smoke --x and --y must be numbers between 0 and 1.');
}
if (!Number.isFinite(inferenceTimeoutMs) || inferenceTimeoutMs < 1_000) {
  throw new Error('Object Selection smoke --inference-timeout must be at least 1000 ms.');
}
if (!['balanced', 'sam2-small', 'slimsam'].includes(backendProfile)) {
  throw new Error('Object Selection smoke --backend must be balanced, sam2-small or slimsam.');
}

await access(sourceFile);
await mkdir(userDataPath, { recursive: true });
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

let failure;
let failureEvidence;
try {
  let page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(500);
  page = app.windows().find((candidate) => candidate.url().startsWith('http://localhost:')) ?? page;
  if (backendProfile !== 'balanced') {
    await app.evaluate(async ({ BrowserWindow }, profile) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!window) throw new Error('No LightTable window is available for backend selection.');
      const target = new URL(window.webContents.getURL());
      target.searchParams.set('lighttable-smart-selection-backend', profile);
      await window.loadURL(target.toString());
    }, backendProfile);
    await page.waitForURL((url) => url.searchParams.get('lighttable-smart-selection-backend') === backendProfile, {
      timeout: 30_000
    });
  }
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const openFile = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'object-selection'
  });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const enterObjectSelection = async () => {
    const group = page.locator('[data-tool-group="Smart selection tools"]');
    await group.locator(':scope > button').click();
    await group.locator('.ui-toolbar__flyout').getByRole('button', { name: /^Object Selection/ }).click();
    await page.locator('[aria-label="Object Selection settings"]:visible').waitFor();
  };
  let lifetimeEvidence;
  if (lifetimeMode) {
    const driver = await attachLightTableAutomation(page, 'object-selection-lifetime');
    const originalId = (await driver.queryWorkspace()).activeDocumentId;
    if (!originalId) throw new Error('Lifetime probe has no opening document.');
    const secondary = await driver.executeWorkspace('document.create', {
      name: 'Object Selection lifetime secondary', width: 64, height: 64, resolutionPpi: 72,
      bitDepth: 8, profile: 'srgb', background: { kind: 'transparent' }
    });
    const secondaryId = secondary.value?.documentId;
    if (!secondaryId) throw new Error(`Lifetime secondary failed: ${JSON.stringify(secondary)}`);
    await driver.waitForReadyDocument(secondaryId);
    const activateTab = async id => {
      const workspace = await driver.queryWorkspace();
      const index = workspace.documents.findIndex(document => document.id === id);
      if (index < 0) throw new Error(`Lifetime tab ${id} is unavailable.`);
      await page.locator('.ui-document-tabs__tab').nth(index).locator('.ui-document-tabs__title').click();
      await driver.waitForReadyDocument(id);
    };
    await activateTab(originalId);
    await enterObjectSelection();
    const subject = page.locator('[aria-label="Object Selection settings"]:visible')
      .getByRole('button', { name: 'Select Subject' });
    await subject.waitFor({ state: 'visible', timeout: 120_000 });
    const before = { original: await driver.queryDocument(originalId),
      secondary: await driver.queryDocument(secondaryId) };
    await page.evaluate(() => {
      globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__ = [];
      globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__ = [];
    });
    await subject.click();
    await page.getByRole('button', { name: 'Transform (V)', exact: true }).click();
    await activateTab(secondaryId);
    // Real UI timing, not a forced backend race. Deferred races are separately
    // covered by owner tests; this checks the retired result's visible aftermath.
    const observationWindowMs = 5_000;
    await page.waitForTimeout(observationWindowMs);
    const after = { original: await driver.queryDocument(originalId),
      secondary: await driver.queryDocument(secondaryId) };
    const trace = await page.evaluate(() => ({
      smart: globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__,
      overlay: globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__
    }));
    for (const name of ['original', 'secondary']) {
      if (after[name].canonicalRevision !== before[name].canonicalRevision
        || after[name].history.currentStateId !== before[name].history.currentStateId
        || after[name].history.undoDepth !== before[name].history.undoDepth) {
        throw new Error(`Retired Select Subject mutated ${name}: ${JSON.stringify({ before, after, trace })}`);
      }
    }
    if (trace.smart.some(entry => entry.event === 'committed')
      || trace.overlay.some(entry => entry.maskActive && entry.sourceKind === 'object-selection')) {
      throw new Error(`Retired Select Subject published a selection: ${JSON.stringify(trace)}`);
    }
    lifetimeEvidence = { before, after, trace, observationWindowMs, forcedDelay: false };
    await activateTab(originalId);
    await page.getByRole('button', { name: 'Transform (V)', exact: true }).click();
    // Continue the ordinary inference/Actions/undo/replay proof on the rebound original.
  }

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Actions panel' }).click();
  const actionsPanel = page.getByRole('complementary', { name: 'Actions' });
  const recorder = actionsPanel.locator('.lighttable-action-recorder');
  await recorder.getByRole('button', { name: 'Record' }).click();

  await enterObjectSelection();
  const objectSelectionSettings = page.locator('[aria-label="Object Selection settings"]:visible');
  await objectSelectionSettings.waitFor({ state: 'visible' });
  if (interactionMode === 'rectangle') {
    const modeSelect = objectSelectionSettings.getByLabel('Object Selection mode');
    await modeSelect.click();
    await page.getByRole('option', { name: 'Rectangle', exact: true }).click();
    if (!(await modeSelect.textContent())?.includes('Rectangle')) {
      throw new Error('The visible Object Selection mode control did not enter Rectangle mode.');
    }
    await page.waitForTimeout(250);
  }

  const canvas = page.locator('.lighttable-viewport__canvas');
  await page.evaluate(() => {
    globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__ = [];
    globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__ = [];
    globalThis.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__ = [];
  });
  const beforeSelection = await canvas.screenshot();
  const clickPoint = await page.evaluate(({ clickXRatio, clickYRatio }) => {
    const target = document.querySelector('.lighttable-viewport__canvas');
    if (!(target instanceof HTMLCanvasElement)) return undefined;
    const bounds = target.getBoundingClientRect();
    // Fit-view always keeps the document center at the viewport center. Prefer
    // that invariant over guessing from the full viewport dimensions, which
    // include black pasteboard around portrait/square documents.
    for (const [xRatio, yRatio] of [[clickXRatio, clickYRatio], [0.5, 0.5], [0.3, 0.3]]) {
      const x = bounds.left + bounds.width * xRatio;
      const y = bounds.top + bounds.height * yRatio;
      if (document.elementFromPoint(x, y) === target) return { x, y };
    }
    return undefined;
  }, { clickXRatio, clickYRatio });
  if (!clickPoint) throw new Error('No unobstructed canvas point is available.');

  const startedAt = performance.now();
  if (interactionMode === 'subject') {
    await objectSelectionSettings.getByRole('button', { name: 'Select Subject' }).click();
  } else if (interactionMode === 'rectangle') {
    await page.mouse.move(clickPoint.x - 24, clickPoint.y - 24);
    await page.mouse.down();
    await page.mouse.move(clickPoint.x + 24, clickPoint.y + 24, { steps: 8 });
    await page.mouse.up();
  } else {
    await page.mouse.click(clickPoint.x, clickPoint.y);
    if (refineNegative) {
      await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
        ?.some((entry) => entry.event === 'candidate-published'), undefined, { timeout: inferenceTimeoutMs });
      await canvas.dispatchEvent('pointerdown', {
        pointerId: 72, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: clickPoint.x - 90, clientY: clickPoint.y, altKey: true
      });
      await canvas.dispatchEvent('pointerup', {
        pointerId: 72, pointerType: 'mouse', button: 0, buttons: 0,
        clientX: clickPoint.x - 90, clientY: clickPoint.y, altKey: true
      });
      await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
        ?.some((entry) => entry.event === 'point-requested' && entry.detail?.label === 'negative'), undefined, { timeout: 5_000 });
    }
  }
  try {
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
      ?.some((entry) => entry.event === 'committed'),
    undefined, { timeout: inferenceTimeoutMs });
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__?.some((entry) => (
      entry.operationCount === 1 && entry.sourceKind === 'object-selection'
        && entry.visible && entry.maskActive
    )), undefined, { timeout: 15_000 });
    const boxError = await page.evaluate(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
      ?.find((entry) => entry.event === 'box-error'));
    if (boxError) throw new Error(`Object Selection box failed: ${JSON.stringify(boxError)}`);
  } catch {
    const trace = await page.evaluate(() => ({
      overlay: globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__,
      smartSelection: globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
    }));
    const status = await page.locator('body').innerText();
    failureEvidence = { trace, status };
    throw new Error(`Object Selection did not publish an active raster selection: ${JSON.stringify({ trace, status })}`);
  }
  let visibleCommitMs;
  const deadline = startedAt + 120_000;
  while (performance.now() < deadline) {
    const body = await page.locator('body').innerText();
    const failureText = body.match(/Object Selection is unavailable[^\n]*|object selection could not be applied[^\n]*/i)?.[0];
    if (failureText) throw new Error(failureText);
    const frame = await canvas.screenshot();
    if (!frame.equals(beforeSelection)) {
      await page.waitForTimeout(500);
      const settledFrame = await canvas.screenshot();
      if (!settledFrame.equals(beforeSelection)) {
        visibleCommitMs = performance.now() - startedAt;
        break;
      }
    }
    await page.waitForTimeout(50);
  }
  if (visibleCommitMs === undefined) {
    throw new Error('Object Selection produced no persistent visible canvas update.');
  }
  if (interactionMode === 'subject') {
    const actionStep = recorder.locator('[data-command="selection.selectSubject"]');
    await actionStep.waitFor({ timeout: 10_000 }).catch(async () => {
      const trace = await page.evaluate(() => ({
        smartSelection: globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__,
        commandObservation: globalThis.__LIGHTTABLE_COMMAND_OBSERVATION_TRACE__
      }));
      throw new Error(`Select Subject Action did not publish: ${JSON.stringify({
        recorder: await recorder.textContent(), trace
      })}`);
    });
    if (await actionStep.count() !== 1) throw new Error('Select Subject published more than one Action.');
    await recorder.getByRole('button', { name: 'Stop' }).click();
    await actionStep.click();
    const inspector = recorder.locator('.lighttable-action-inspector');
    await inspector.locator('summary').click();
    const actionText = await inspector.textContent();
    if (!actionText?.includes('Selection kind') || !actionText.includes('Source layer ID')
      || /model|backend|candidate|refinement|pointerId|pressure|raster-mask|tensor|maskBytes/i.test(actionText)) {
      throw new Error(`Select Subject crossed an invalid Action boundary: ${actionText}`);
    }
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    await recorder.getByRole('button', { name: 'Play', exact: true }).click();
    await recorder.getByRole('status').filter({ hasText: 'Playback: completed' })
      .waitFor({ timeout: Math.max(30_000, inferenceTimeoutMs + 15_000) }).catch(async () => {
        throw new Error(`Select Subject Action playback did not complete: ${await recorder.textContent()}`);
      });
  }
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !(
    message.includes('onnxruntime')
    && (message.includes("can't constant fold")
      || message.includes('were not assigned to the preferred execution providers')
      || message.includes('Rerunning with verbose output on a non-minimal build'))
  ));
  if (pageErrors.length || unexpectedConsoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({
      pageErrors, consoleErrors: unexpectedConsoleErrors
    })}`);
  }
  await page.screenshot({ path: screenshotPath });
  const selectionTrace = await page.evaluate(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__);
  const smartSelectionTrace = await page.evaluate(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__);
  const observedModelIds = [...new Set((smartSelectionTrace ?? [])
    .filter((entry) => entry.event === 'backend-metric')
    .map((entry) => entry.detail?.modelId)
    .filter(Boolean))];
  const expectedModelId = backendProfile === 'sam2-small'
    ? 'onnx-community/sam2.1-hiera-small-ONNX'
    : backendProfile === 'slimsam' ? 'Xenova/slimsam-77-uniform' : undefined;
  if (expectedModelId && !observedModelIds.includes(expectedModelId)) {
    throw new Error(`Requested ${backendProfile}, but observed metrics from ${JSON.stringify(observedModelIds)}.`);
  }
  const publishedCandidates = smartSelectionTrace
    ?.filter((entry) => entry.event === 'candidate-published') ?? [];
  const finalCoverage = publishedCandidates.at(-1)?.detail
    ?? smartSelectionTrace?.filter((entry) => entry.event === 'committed').at(-1)?.detail;
  if (!finalCoverage || finalCoverage.selectedMean < 0.85) {
    throw new Error(
      `Object Selection produced an excessively translucent mask: ${JSON.stringify(finalCoverage)}`
    );
  }
  if (lifetimeEvidence) {
    const driver = await attachLightTableAutomation(page, 'object-selection-lifetime-final');
    const before = lifetimeEvidence.before.secondary;
    const after = await driver.queryDocument(before.id);
    if (!after || after.canonicalRevision !== before.canonicalRevision
      || after.history.currentStateId !== before.history.currentStateId
      || after.history.undoDepth !== before.history.undoDepth) {
      throw new Error(`Retired Select Subject mutated the secondary during fresh inference/replay: ${JSON.stringify({ before, after })}`);
    }
    lifetimeEvidence.afterNormalInferenceAndReplay = { secondary: after };
  }
  const report = {
    passed: true, lifetimeEvidence,
    caseName, sourceFile, backendProfile, observedModelIds,
    interactionMode, refineNegative, clickXRatio, clickYRatio,
    visibleCommitMs, finalCoverage, selectionTrace, smartSelectionTrace, pageErrors,
    consoleErrors: unexpectedConsoleErrors, runtimeWarnings: consoleErrors.length, screenshotPath
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Object Selection desktop smoke passed; persistent canvas feedback in ${visibleCommitMs.toFixed(1)} ms. `
    + `Screenshot: ${screenshotPath}\n`
  );
} catch (error) {
  failure = error;
  await writeFile(reportPath, `${JSON.stringify({
    caseName,
    sourceFile,
    backendProfile,
    interactionMode,
    refineNegative,
    lifetimeMode,
    clickXRatio,
    clickYRatio,
    passed: false,
    error: error instanceof Error ? error.message : String(error),
    evidence: failureEvidence
  }, null, 2)}\n`);
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
} finally {
  await app.close();
}
if (failure) process.exitCode = 1;
