import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const engine = argument('engine');
const sourceFile = path.resolve(argument('file') ?? '');
const iterations = Number.parseInt(argument('iterations', '8'), 10);
const targetName = argument('layer-name');
const targetType = engine === 'vector' ? 'vector' : engine === 'text' ? 'text' : null;
if (!['compositor', 'vector', 'text'].includes(engine) || !sourceFile) {
  throw new Error('Usage: audit-desktop-render-engines.mjs --engine <compositor|vector|text> --file <path> [--iterations 8] [--layer-name name]');
}
if (!Number.isInteger(iterations) || iterations < 3) throw new Error('Iterations must be at least 3.');

const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'quality-audit', 'render-engines', engine);
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');
const screenshotPath = path.join(outputDirectory, 'reference.png');
await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const percentile = (values, fraction) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
};
const summarize = (values) => ({
  minimumMs: Math.min(...values),
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maximumMs: Math.max(...values)
});
const parseRenderTelemetry = (text) => {
  const integer = (label) => Number(text.match(new RegExp(`${label}: (\\d+)`, 'i'))?.[1] ?? 0);
  const stages = {};
  for (const stage of [
    'document-composite', 'source-geometry', 'linear-spatial',
    'output', 'display-post', 'display-resolve'
  ]) {
    const match = text.match(new RegExp(
      `${stage}: (\\d+) executions; (\\d+) correction-frame reuses; encode total ([\\d.]+) ms; last ([\\d.]+) ms; max ([\\d.]+) ms`,
      'i'
    ));
    stages[stage] = match ? {
      executions: Number(match[1]),
      correctionFrameReuses: Number(match[2]),
      totalEncodeMs: Number(match[3]),
      lastEncodeMs: Number(match[4]),
      maximumEncodeMs: Number(match[5])
    } : null;
  }
  return {
    renderCalls: integer('Render calls'),
    submittedFrames: integer('Submitted frames'),
    noWorkSkips: integer('No-work skips'),
    correctionFrames: integer('Correction frames'),
    scopeAnalysisPasses: integer('Scope analysis passes'),
    scopeDisplayPasses: integer('Scope display passes'),
    stages
  };
};

const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const report = {
  engine, sourceFile, iterations, targetName, cycles: [], pageErrors: [], consoleErrors: []
};
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

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 90_000 });
  const driver = await attachLightTableAutomation(page, `render-${engine}`);
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const layers = await driver.queryLayers(documentId);
  const candidates = layers?.filter((layer) => layer.visible && layer.type !== 'group') ?? [];
  const target = candidates.find((layer) => targetName && layer.name === targetName)
    ?? candidates.find((layer) => !targetType || layer.type === targetType);
  if (!target) throw new Error(`No visible ${targetType ?? 'compositable'} layer was found.`);
  report.target = target;

  await page.evaluate(() => {
    globalThis.__lightTableEngineAudit = { longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableEngineAudit.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const memory = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const metrics = await cdp.send('Performance.getMetrics');
    const value = (name) => metrics.metrics.find((entry) => entry.name === name)?.value ?? null;
    return { heapUsedBytes: value('JSHeapUsedSize') };
  };
  const canvas = page.locator('.lighttable-viewport__canvas');
  const settle = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(24);
  };
  const stableCanvasScreenshot = async () => {
    let previousHash = null;
    let screenshot = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await settle();
      screenshot = await canvas.screenshot();
      const currentHash = hash(screenshot);
      if (currentHash === previousHash) return screenshot;
      previousHash = currentHash;
    }
    throw new Error('The canvas did not reach two identical presentation frames.');
  };
  const openDebug = async () => {
    await page.getByRole('tab', { name: 'Debug', exact: true }).click();
    await page.getByRole('region', { name: 'LightTable debug log' }).waitFor({ state: 'visible' });
  };
  const resetTelemetry = async () => {
    await openDebug();
    await page.getByRole('button', { name: 'Reset render stats' }).click();
    await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  };
  const captureTelemetry = async () => {
    await openDebug();
    await page.getByRole('button', { name: 'Capture render stats' }).click();
    const message = page.locator('.lighttable-debug-message').filter({ hasText: 'Render telemetry' }).last();
    await message.waitFor({ state: 'visible' });
    const details = await message.locator('pre').textContent();
    if (!details) throw new Error('Render telemetry details were not published.');
    return { raw: details, parsed: parseRenderTelemetry(details) };
  };

  await stableCanvasScreenshot();
  report.before = { ...(await memory()), ...(await driver.queryDocument(documentId))?.renderer };
  await resetTelemetry();
  let referenceHash = null;
  for (let cycle = 0; cycle < iterations; cycle += 1) {
    const hideStartedAt = performance.now();
    await driver.execute(documentId, 'layer.setVisibility', { layerIds: [target.id], visible: false });
    await settle();
    const hiddenMs = performance.now() - hideStartedAt;
    const showStartedAt = performance.now();
    await driver.execute(documentId, 'layer.setVisibility', { layerIds: [target.id], visible: true });
    const screenshot = await stableCanvasScreenshot();
    const visibleMs = performance.now() - showStartedAt;
    const screenshotHash = hash(screenshot);
    if (cycle === 0) {
      referenceHash = screenshotHash;
      await writeFile(screenshotPath, screenshot);
    }
    report.cycles.push({
      cycle: cycle + 1,
      hiddenMs,
      visibleMs,
      screenshotHash,
      matchesReference: screenshotHash === referenceHash,
      estimatedGpuBytes: (await driver.queryDocument(documentId))?.renderer.estimatedGpuBytes ?? null
    });
  }
  report.telemetry = await captureTelemetry();
  report.after = { ...(await memory()), ...(await driver.queryDocument(documentId))?.renderer };
  report.longTasks = await page.evaluate(() => globalThis.__lightTableEngineAudit.longTasks);
  report.runtimeStopped = /document runtime stopped unexpectedly/i.test(await page.locator('body').innerText());
  report.summary = {
    hide: summarize(report.cycles.map(({ hiddenMs }) => hiddenMs)),
    show: summarize(report.cycles.map(({ visibleMs }) => visibleMs)),
    heapDeltaBytes: report.after.heapUsedBytes - report.before.heapUsedBytes,
    gpuDeltaBytes: report.after.estimatedGpuBytes - report.before.estimatedGpuBytes
  };
  if (report.cycles.some(({ matchesReference }) => !matchesReference)) {
    throw new Error('Restoring the layer did not reproduce the reference viewport exactly.');
  }
  if (report.pageErrors.length || report.consoleErrors.length || report.runtimeStopped) {
    throw new Error('Render engine audit observed a runtime failure.');
  }
  if (report.summary.heapDeltaBytes > 5 * 1024 * 1024) {
    throw new Error(`Heap retention exceeded 5 MiB: ${report.summary.heapDeltaBytes} bytes.`);
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Render engine audit passed. Report: ${reportPath}\n`);
