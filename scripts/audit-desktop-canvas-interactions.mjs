import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:/shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'quality-audit', 'canvas-interactions');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');
const screenshotPath = path.join(outputDirectory, 'final.png');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
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
  await page.getByRole('button', { name: 'Open file' }).click();
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
  const point = (x, y) => ({ x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });
  const settleFrame = () => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  }));
  const measure = async (name, action) => {
    const before = await driver.queryDocument(documentId);
    const startedAt = performance.now();
    await action();
    await settleFrame();
    const after = await driver.queryDocument(documentId);
    report.actions.push({
      name,
      durationMs: performance.now() - startedAt,
      historyDelta: (after?.history.undoDepth ?? 0) - (before?.history.undoDepth ?? 0),
      historyBytesBefore: before?.history.estimatedBytes ?? null,
      historyBytesAfter: after?.history.estimatedBytes ?? null,
      historyBytesDelta: before && after
        ? after.history.estimatedBytes - before.history.estimatedBytes
        : null,
      estimatedGpuBytesBefore: before?.renderer.estimatedGpuBytes ?? null,
      estimatedGpuBytesAfter: after?.renderer.estimatedGpuBytes ?? null,
      estimatedGpuBytesDelta: before && after
        ? after.renderer.estimatedGpuBytes - before.renderer.estimatedGpuBytes
        : null,
      zoomBefore: before?.viewport.scale ?? null,
      zoomAfter: after?.viewport.scale ?? null
    });
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

  await page.keyboard.press('h');
  await measure('pan-drag', () => drag(point(0.18, 0.20), point(0.26, 0.27), 24));
  await page.keyboard.press('z');
  await measure('zoom-click', () => page.mouse.click(point(0.20, 0.20).x, point(0.20, 0.20).y));

  const rectangular = point(0.14, 0.17);
  const rectangularEnd = point(0.29, 0.31);
  await selectFamilyTool('Rectangular selection (M)');
  await measure('selection-rectangle', () => drag(rectangular, rectangularEnd));
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
  await measure('brush-stroke', () => drag(point(0.17, 0.20), point(0.30, 0.27), 32));

  await page.keyboard.press('e');
  await measure('erase-stroke', () => drag(point(0.17, 0.20), point(0.30, 0.27), 32));

  await page.keyboard.press('w');
  await measure('warp-stroke', () => drag(point(0.18, 0.22), point(0.31, 0.29), 32));

  await page.keyboard.press('Control+t');
  await page.getByLabel('Transform controls').waitFor({ state: 'visible', timeout: 30_000 });
  await measure('transform-cancel', () => page.keyboard.press('Escape'));

  await page.getByRole('button', { name: 'Add layer mask' }).click();
  const activeMask = page.locator('.lighttable-layer--active .lighttable-layer__mask');
  await activeMask.waitFor({ state: 'visible' });
  await activeMask.click();
  await page.keyboard.press('b');
  await measure('mask-brush-stroke', () => drag(point(0.18, 0.21), point(0.27, 0.26), 20));
  await measure('mask-invert', () => page.keyboard.press('Control+i'));
  await measure('mask-fill-foreground', () => page.keyboard.press('Alt+Delete'));
  await page.keyboard.press('g');
  await measure('mask-gradient', () => drag(point(0.17, 0.20), point(0.30, 0.28), 8));

  // Re-run non-destructive viewport and selection interactions after all tool
  // code paths are warm. GC-backed samples catch retained React trees,
  // listeners and controller state without confusing undo-owned pixel buffers
  // with leaks.
  report.retentionSamples = [];
  for (let round = 0; round < 5; round += 1) {
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
    report.retentionSamples.push({ round: round + 1, ...(await browserMetrics()) });
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
  const stableEnd = report.retentionSamples.at(-1);
  report.retentionDelta = {
    heapUsedBytes: stableEnd.heapUsedBytes - stableStart.heapUsedBytes,
    domNodes: stableEnd.domNodes - stableStart.domNodes,
    eventListeners: stableEnd.eventListeners - stableStart.eventListeners
  };
  if (
    report.retentionDelta.heapUsedBytes > 5 * 1024 * 1024
    || report.retentionDelta.domNodes > 100
    || report.retentionDelta.eventListeners > 25
  ) {
    throw new Error(`Canvas interaction retention exceeded its budget: ${JSON.stringify(report.retentionDelta)}`);
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
