import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { assessGpuRetentionTrend } from './release-soak-policy.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:/shapes.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const outputDirectory = path.join(workspaceRoot, 'tmp', 'quality-audit', 'canvas-interactions');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');
const screenshotPath = path.join(outputDirectory, 'final.png');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
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

const report = { sourceFile, actions: [], pageErrors: [], consoleErrors: [] };
let page;
let browserMetrics;

try {
  page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.evaluate(() => {
    localStorage.setItem('lighttable:preferences', JSON.stringify({
      version: 1,
      autosave: { enabled: true, intervalMs: 30_000 },
      tools: { zoomWithScrollWheel: false, openMaskEditingOnDoubleClick: true }
    }));
  });
  await page.reload();
  const openFileButton = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors: report.pageErrors, label: 'canvas'
  });
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'canvas-interaction-audit');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  await driver.execute(documentId, 'layer.createRaster', {});

  await page.evaluate(() => {
    globalThis.__lightTableInteractionAudit = { longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableInteractionAudit.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  browserMetrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const [performanceMetrics, dom] = await Promise.all([
      cdp.send('Performance.getMetrics'),
      cdp.send('Memory.getDOMCounters')
    ]);
    const metric = (name) => performanceMetrics.metrics.find((entry) => entry.name === name)?.value ?? null;
    return {
      heapUsedBytes: metric('JSHeapUsedSize'),
      domNodes: dom.nodes,
      eventListeners: dom.jsEventListeners
    };
  };
  report.before = await browserMetrics();

  const viewport = page.locator('.lighttable-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  const canvas = (await driver.queryDocument(documentId))?.canvas;
  if (!canvas) throw new Error('Document canvas dimensions are unavailable.');
  const fitScale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height) * 0.94;
  const documentBounds = {
    x: bounds.x + (bounds.width - canvas.width * fitScale) / 2,
    y: bounds.y + (bounds.height - canvas.height * fitScale) / 2,
    width: canvas.width * fitScale,
    height: canvas.height * fitScale
  };
  report.documentBounds = documentBounds;
  const point = (x, y) => ({
    x: documentBounds.x + documentBounds.width * x,
    y: documentBounds.y + documentBounds.height * y
  });
  const settleFrame = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  }));
  const measure = async (name, action, expectation = null) => {
    const before = await driver.queryDocument(documentId);
    await driver.resetRenderTelemetry(documentId);
    const startedAt = performance.now();
    await action();
    await settleFrame();
    const after = await driver.queryDocument(documentId);
    const renderTelemetry = await driver.queryRenderTelemetry(documentId);
    const result = {
      name,
      durationMs: performance.now() - startedAt,
      historyDelta: (after?.history.undoDepth ?? 0) - (before?.history.undoDepth ?? 0),
      historyBytesBefore: before?.history.estimatedBytes ?? null,
      historyBytesAfter: after?.history.estimatedBytes ?? null,
      historyBytesDelta: before && after
        ? after.history.estimatedBytes - before.history.estimatedBytes
        : null,
      historyStateBefore: before?.history.currentStateId ?? null,
      historyStateAfter: after?.history.currentStateId ?? null,
      historyStateDelta: before && after
        ? after.history.currentStateId - before.history.currentStateId
        : null,
      estimatedGpuBytesBefore: before?.renderer.estimatedGpuBytes ?? null,
      estimatedGpuBytesAfter: after?.renderer.estimatedGpuBytes ?? null,
      estimatedGpuBytesDelta: before && after
        ? after.renderer.estimatedGpuBytes - before.renderer.estimatedGpuBytes
        : null,
      zoomBefore: before?.viewport.scale ?? null,
      zoomAfter: after?.viewport.scale ?? null,
      renderTelemetry
    };
    report.actions.push(result);
    if (expectation && !expectation(result)) {
      throw new Error(`${name} did not mutate the intended pixel history: ${JSON.stringify(result)}`);
    }
  };
  const drag = async (start, end, steps = 16) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps });
    await page.mouse.up();
  };
  const selectFamilyTool = async (name) => {
    await page.getByRole('button', { name: 'Show selection tools' }).click();
    const button = page.getByRole('toolbar', { name: 'Selection tools' })
      .getByRole('button', { name, exact: true });
    await button.click();
  };

  const horizontalWheelBefore = await driver.queryDocument(documentId);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await app.evaluate(({ BrowserWindow }, input) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('lighttable:horizontal-wheel', input);
  }, {
    clientX: Math.round(bounds.x + bounds.width / 2),
    clientY: Math.round(bounds.y + bounds.height / 2),
    deltaX: 120
  });
  await settleFrame();
  const horizontalWheelAfter = await driver.queryDocument(documentId);
  const horizontalWheelResult = {
    name: 'desktop-horizontal-wheel-pan',
    panXBefore: horizontalWheelBefore?.viewport.panX ?? null,
    panXAfter: horizontalWheelAfter?.viewport.panX ?? null,
    panYBefore: horizontalWheelBefore?.viewport.panY ?? null,
    panYAfter: horizontalWheelAfter?.viewport.panY ?? null
  };
  report.actions.push(horizontalWheelResult);
  if (horizontalWheelResult.panXBefore === null || horizontalWheelResult.panXAfter === null
    || horizontalWheelResult.panXAfter === horizontalWheelResult.panXBefore
    || horizontalWheelResult.panYAfter !== horizontalWheelResult.panYBefore) {
    throw new Error(`Desktop horizontal wheel did not pan only the x-axis: ${JSON.stringify(
      horizontalWheelResult
    )}`);
  }

  await page.keyboard.press('h');
  await measure('pan-drag', () => drag(point(0.18, 0.20), point(0.26, 0.27), 24));
  await page.keyboard.press('Control+0');
  await page.keyboard.press('z');
  await measure('zoom-click', () => page.mouse.click(point(0.20, 0.20).x, point(0.20, 0.20).y));
  await page.keyboard.press('Control+0');

  const rectangular = point(0.14, 0.17);
  const rectangularEnd = point(0.29, 0.31);
  await selectFamilyTool('Rectangular selection (M)');
  await measure('selection-rectangle', () => drag(rectangular, rectangularEnd));
  if (!await driver.resetRenderTelemetry(documentId)) {
    throw new Error('Render telemetry could not be reset for the selection overlay audit.');
  }
  await page.waitForTimeout(1_100);
  report.selectionOverlayTelemetry = await driver.queryRenderTelemetry(documentId);
  if (!report.selectionOverlayTelemetry
    || report.selectionOverlayTelemetry.submittedFrames < 1
    || report.selectionOverlayTelemetry.stages['document-composite'].executions !== 0
    || report.selectionOverlayTelemetry.correctionFrames !== 0) {
    throw new Error(`Selection ants dirtied document composition: ${JSON.stringify(
      report.selectionOverlayTelemetry
    )}`);
  }

  const selectionModes = page.getByRole('radiogroup', { name: 'Selection combine mode' });
  await selectionModes.getByRole('radio', { name: 'Add to selection' }).click();
  await measure('selection-add', () => drag(point(0.25, 0.24), point(0.38, 0.37), 8));
  await selectionModes.getByRole('radio', { name: 'Subtract from selection' }).click();
  await measure('selection-subtract', () => drag(point(0.27, 0.26), point(0.31, 0.30), 8));
  await selectionModes.getByRole('radio', { name: 'Intersect with selection' }).click();
  await measure('selection-intersect', () => drag(point(0.20, 0.20), point(0.34, 0.34), 8));
  await selectionModes.getByRole('radio', { name: 'New selection' }).click();
  await measure('selection-off-canvas', () => drag(
    { x: documentBounds.x - 20, y: documentBounds.y - 15 },
    point(0.12, 0.14),
    8
  ));
  await page.keyboard.press('Shift+F6');
  const featherDialog = page.getByRole('dialog', { name: 'Select feather' });
  await featherDialog.waitFor({ state: 'visible' });
  await featherDialog.getByRole('textbox').fill('12');
  await featherDialog.getByRole('button', { name: /ok|confirm/i }).click();
  await settleFrame();
  await page.keyboard.press('Control+d');

  await selectFamilyTool('Elliptical selection (Shift+M)');
  await measure('selection-ellipse', () => drag(point(0.16, 0.18), point(0.31, 0.33)));
  await page.keyboard.press('Control+d');

  await selectFamilyTool('Free selection (L)');
  await measure('selection-free', () => drag(point(0.15, 0.18), point(0.30, 0.31), 28));
  await page.keyboard.press('Control+d');

  await selectFamilyTool('Polygonal selection (Shift+L)');
  await measure('selection-polygonal', async () => {
    const a = point(0.15, 0.18); const b = point(0.30, 0.18); const c = point(0.24, 0.32);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.mouse.click(c.x, c.y);
    await page.mouse.dblclick(a.x, a.y);
  });
  await page.keyboard.press('Control+d');

  await selectFamilyTool('Horizontal selection');
  await measure('selection-horizontal', () => page.mouse.click(point(0.20, 0.23).x, point(0.20, 0.23).y));
  await page.keyboard.press('Control+d');

  await selectFamilyTool('Vertical selection');
  await measure('selection-vertical', () => page.mouse.click(point(0.22, 0.23).x, point(0.22, 0.23).y));
  await page.keyboard.press('Control+d');

  await page.keyboard.press('b');
  await measure(
    'brush-stroke',
    () => drag(point(0.17, 0.20), point(0.30, 0.27), 32),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );
  await measure('brush-undo', () => driver.execute(documentId, 'history.undo'));
  await measure('brush-redo', () => driver.execute(documentId, 'history.redo'));

  await page.keyboard.press('e');
  await measure(
    'erase-stroke',
    () => drag(point(0.17, 0.20), point(0.30, 0.27), 32),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );

  await page.keyboard.press('w');
  await measure('warp-stroke', () => drag(point(0.18, 0.22), point(0.31, 0.29), 32));

  await page.keyboard.press('Control+t');
  await page.getByLabel('Transform controls').waitFor({ state: 'visible', timeout: 30_000 });
  await measure('transform-cancel', () => page.keyboard.press('Escape'));

  // Exercise mask painting on a stable, unwarped raster owner. The earlier
  // raster deliberately carries erase/warp history and is not a clean mask
  // lifecycle fixture.
  await driver.execute(documentId, 'layer.createRaster', {});
  await page.keyboard.press('d');
  await page.keyboard.press('b');
  await drag(point(0.18, 0.21), point(0.20, 0.22), 4);
  await page.getByRole('button', { name: 'Add layer mask' }).click();
  const activeMask = page.locator('.lighttable-layer--active .lighttable-layer__mask');
  await activeMask.waitFor({ state: 'visible' });
  await activeMask.click();
  await page.locator('.lighttable-layer--active .lighttable-layer__thumbnail--active-mask')
    .waitFor({ state: 'visible' });
  // A fresh mask is opaque white. Reset to Photoshop's black foreground /
  // white background and explicitly initialize the complete mask to white.
  // This also clears any asynchronously-settling selection state left by the
  // selection-tool journey, so the black stroke is always a real mutation.
  await page.keyboard.press('d');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Delete');
  await page.keyboard.press('Control+d');
  await settleFrame();
  await page.keyboard.press('b');
  await measure(
    'mask-brush-stroke',
    () => drag(point(0.18, 0.21), point(0.27, 0.26), 20),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );
  await measure('mask-brush-undo', () => driver.execute(documentId, 'history.undo'));
  await measure('mask-brush-redo', () => driver.execute(documentId, 'history.redo'));
  await page.locator('.lighttable-layer--active .lighttable-layer__mask').click();
  await page.locator('.lighttable-layer--active .lighttable-layer__thumbnail--active-mask')
    .waitFor({ state: 'visible' });
  await measure(
    'mask-invert',
    () => page.keyboard.press('Control+i'),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );
  await measure(
    'mask-fill-foreground',
    () => page.keyboard.press('Alt+Delete'),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );
  await page.keyboard.press('g');
  await measure(
    'mask-gradient',
    () => drag(point(0.17, 0.20), point(0.30, 0.28), 8),
    ({ historyDelta, historyStateDelta }) => historyDelta === 1 && historyStateDelta === 1
  );

  // Re-run non-destructive viewport and selection interactions after all tool
  // code paths are warm. GC-backed samples catch retained React trees,
  // listeners and controller state without confusing undo-owned pixel buffers
  // with leaks.
  report.retentionSamples = [];
  for (let round = 0; round < 9; round += 1) {
    await page.keyboard.press('Control+0');
    await page.keyboard.press('h');
    await drag(point(0.19, 0.21), point(0.21, 0.23), 4);
    await page.keyboard.press('z');
    await page.mouse.click(point(0.20, 0.20).x, point(0.20, 0.20).y);
    await page.keyboard.down('Alt');
    await page.mouse.click(point(0.20, 0.20).x, point(0.20, 0.20).y);
    await page.keyboard.up('Alt');
    await selectFamilyTool('Rectangular selection (M)');
    await drag(point(0.16, 0.18), point(0.21, 0.23), 4);
    await page.keyboard.press('Control+d');
    await settleFrame();
    const retainedDocument = await driver.queryDocument(documentId);
    report.retentionSamples.push({
      round: round + 1,
      ...(await browserMetrics()),
      estimatedGpuBytes: retainedDocument?.renderer.estimatedGpuBytes ?? null
    });
  }

  await page.screenshot({ path: screenshotPath });
  report.after = await browserMetrics();
  report.longTasks = await page.evaluate(() => globalThis.__lightTableInteractionAudit.longTasks);
  report.runtimeStopped = /document runtime stopped unexpectedly/i.test(await page.locator('body').innerText());
  report.screenshotPath = screenshotPath;
  const slowActions = report.actions.filter(({ durationMs }) => durationMs > 250);
  if (report.pageErrors.length || report.consoleErrors.length || report.runtimeStopped) {
    throw new Error(`Canvas audit runtime failure: ${JSON.stringify({
      pageErrors: report.pageErrors,
      consoleErrors: report.consoleErrors,
      runtimeStopped: report.runtimeStopped
    })}`);
  }
  report.slowActions = slowActions;
  const stableStart = report.retentionSamples[1];
  const steadyStateStart = report.retentionSamples.at(-4);
  const stableEnd = report.retentionSamples.at(-1);
  report.warmRetentionDelta = {
    heapUsedBytes: stableEnd.heapUsedBytes - stableStart.heapUsedBytes,
    domNodes: stableEnd.domNodes - stableStart.domNodes,
    eventListeners: stableEnd.eventListeners - stableStart.eventListeners,
    estimatedGpuBytes: stableStart.estimatedGpuBytes == null || stableEnd.estimatedGpuBytes == null
      ? null : stableEnd.estimatedGpuBytes - stableStart.estimatedGpuBytes
  };
  report.retentionDelta = {
    heapUsedBytes: stableEnd.heapUsedBytes - steadyStateStart.heapUsedBytes,
    domNodes: stableEnd.domNodes - steadyStateStart.domNodes,
    eventListeners: stableEnd.eventListeners - steadyStateStart.eventListeners,
    estimatedGpuBytes: steadyStateStart.estimatedGpuBytes == null || stableEnd.estimatedGpuBytes == null
      ? null : stableEnd.estimatedGpuBytes - steadyStateStart.estimatedGpuBytes
  };
  // A lazily-realized, bounded GPU resource can appear in any warm repetition.
  // Classify the complete high-water trend instead of requiring a fixed zero-
  // allocation warm-up. Bounded pool/cache realization is reported, while
  // repeated new highs in the stable tail or more than 1 MiB of total retained
  // growth remain hard failures.
  report.gpuRetentionTrend = assessGpuRetentionTrend(report.retentionSamples);
  if (
    report.retentionDelta.heapUsedBytes > 5 * 1024 * 1024
    || report.retentionDelta.domNodes > 100
    || report.retentionDelta.eventListeners > 25
    || !report.gpuRetentionTrend.passed
  ) {
    throw new Error(`Canvas interaction retention exceeded its budget: ${JSON.stringify({
      retentionDelta: report.retentionDelta,
      gpuRetentionTrend: report.gpuRetentionTrend
    })}`);
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Canvas interaction audit passed. Report: ${reportPath}\n`);
} catch (error) {
  report.after = await browserMetrics?.().catch(() => null) ?? null;
  report.longTasks = await page?.evaluate(() => globalThis.__lightTableInteractionAudit?.longTasks ?? [])
    .catch(() => []);
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  throw error;
} finally {
  await app.close().catch(() => {});
}
