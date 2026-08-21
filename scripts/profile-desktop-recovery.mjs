import { _electron as electron } from 'playwright-core';
import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import {
  captureDesktopTestState,
  resolveDesktopTestLaunch,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const launch = await resolveDesktopTestLaunch(workspace);
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const output = path.resolve(args.find((value) => value.startsWith('--output='))?.slice(9)
  ?? path.join(workspace, 'tmp', 'quality-audit', 'recovery-qualification'));
const requested = args.filter((value) => !value.startsWith('--'));
const defaults = [
  'D:/mediavibe/LightTable/tmp/mcp-design-smoke/agent-release-card.lighttable',
  'D:/mediavibe/LightTableTestFiles/RandomFiles/shapes.psd',
  'D:/mediavibe/LightTableTestFiles/RandomFiles/TextTest.psd',
  'D:/mediavibe/LightTableTestFiles/psd/templates/Save the Date Invitation PSD 6/EHS-396/EHS-396/EHS-396.psd'
];
const sources = (requested.length ? requested : defaults).slice(0, quick ? 3 : undefined)
  .map((value) => path.resolve(value));
const percentile = (values, fraction) => values.length
  ? values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : null;
const summarize = (values) => ({ count: values.length, minMs: values.length ? Math.min(...values) : null,
  medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99),
  maxMs: values.length ? Math.max(...values) : null });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalizedCanvas = async (bytes) => {
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const inset = 8;
  const cropped = await image.extract({ left: inset, top: inset,
    width: Math.max(1, (metadata.width ?? inset * 2 + 1) - inset * 2),
    height: Math.max(1, (metadata.height ?? inset * 2 + 1) - inset * 2) }).toBuffer();
  return sharp(cropped).trim({ threshold: 5 }).resize(256, 256, { fit: 'fill' })
    .removeAlpha().raw().toBuffer();
};
const rmse = (left, right) => {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) squared += (left[index] - right[index]) ** 2;
  return Math.sqrt(squared / left.length);
};
const hideFloatingLayersPanel = (page) => page.evaluate(() => {
  let element = document.querySelector('.lighttable-layers-panel');
  while (element) {
    const bounds = element.getBoundingClientRect();
    if (bounds.width >= 500 || bounds.height >= 700) break;
    element.style.setProperty('visibility', 'hidden', 'important');
    element = element.parentElement;
  }
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

await Promise.all([access(launch.executablePath), mkdir(output, { recursive: true })]);
const report = {
  generatedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
  hardware: { cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem() }, thresholds: { p95ViewportMs: 33, maximumLongTaskMs: 100,
    maximumRecoveryRegressionRatio: 1.25, maximumRecoveryAgeMs: quick ? 90_000 : 300_000 }, cases: []
};

for (const [index, sourceFile] of sources.entries()) {
  const source = { path: sourceFile, bytes: null, status: 'pending', pageErrors: [], consoleErrors: [], recoveryLog: [] };
  report.cases.push(source);
  let app;
  try {
    source.bytes = (await stat(sourceFile)).size;
    const userData = path.join(output, `user-data-${index}`);
    await mkdir(userData, { recursive: true });
    app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
      cwd: workspace, env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
        LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
    const page = await app.firstWindow({ timeout: 30_000 });
    page.on('pageerror', (error) => source.pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error') source.consoleErrors.push(text);
      if (text.includes('[Recovery]')) source.recoveryLog.push({ at: Date.now(), type: message.type(), text });
    });
    await page.evaluate(() => {
      globalThis.__lightTableRecoveryLongTasks = [];
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver((list) => {
        globalThis.__lightTableRecoveryLongTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime, duration: entry.duration
        })));
      }).observe({ type: 'longtask', buffered: true });
    });
    const openedAt = performance.now();
    const openFileButton = await waitForDesktopLauncher({
      app, page, outputDirectory: output, sourceFile, pageErrors: source.pageErrors,
      label: `recovery-open-${index}`
    });
    await openFileButton.click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: source.bytes > 100_000_000 ? 180_000 : 60_000 });
    source.openMs = performance.now() - openedAt;
    await page.evaluate(() => { globalThis.__lightTableRecoveryLongTasks = []; });
    const driver = await attachLightTableAutomation(page, `recovery-profile-${index}`);
    const documentId = (await driver.queryWorkspace())?.activeDocumentId;
    if (!documentId) throw new Error('The opened source has no active document.');
    source.document = await driver.queryDocument(documentId);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
      const metrics = await cdp.send('Performance.getMetrics');
      return metrics.metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? null;
    };
    const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const viewportSamples = async (count) => {
      const values = [];
      for (let sample = 0; sample < count; sample += 1) {
        const started = performance.now();
        await driver.execute(documentId, 'view.setZoom', { mode: sample % 2 ? 'fit' : '100' });
        await frame();
        values.push(performance.now() - started);
      }
      return values;
    };
    source.heapBeforeBytes = await heap();
    await viewportSamples(6);
    source.baselineViewport = summarize(await viewportSamples(24));
    source.baselineLongTasks = summarize((await page.evaluate(() => {
      const tasks = globalThis.__lightTableRecoveryLongTasks ?? [];
      globalThis.__lightTableRecoveryLongTasks = [];
      return tasks;
    })).map(({ duration }) => duration));
    const editStarted = performance.now(); const editWallAt = Date.now();
    await driver.execute(documentId, 'layer.createRaster', {});
    source.semanticEditMs = performance.now() - editStarted;
    await frame();
    // Let the semantic edit's own render work settle. The recovery debounce has
    // not elapsed yet, so the next window measures interaction while a recovery
    // checkpoint is queued rather than the cost of creating the layer itself.
    await delay(source.bytes >= 32 * 1024 * 1024 ? 2_000 : 500);
    source.queuedViewport = summarize(await viewportSamples(24));
    source.queuedLongTasks = summarize((await page.evaluate(() => {
      const tasks = globalThis.__lightTableRecoveryLongTasks ?? [];
      globalThis.__lightTableRecoveryLongTasks = [];
      return tasks;
    })).map(({ duration }) => duration));
    const deadline = Date.now() + report.thresholds.maximumRecoveryAgeMs;
    while (!source.recoveryLog.some(({ text }) => text.includes('Preparing revision')) && Date.now() < deadline) {
      if (source.recoveryLog.some(({ text }) => /unavailable|failed/iu.test(text))) break;
      await delay(100);
    }
    const recoveryViewportPromise = source.recoveryLog.some(({ text }) => text.includes('Checkpoint committed:'))
      ? Promise.resolve([]) : viewportSamples(24);
    while (!source.recoveryLog.some(({ text }) => text.includes('Checkpoint committed:')) && Date.now() < deadline) {
      if (source.recoveryLog.some(({ text }) => /unavailable|failed/iu.test(text))) break;
      await delay(100);
    }
    source.recoveryViewport = summarize(await recoveryViewportPromise);
    const committed = source.recoveryLog.find(({ text }) => text.includes('Checkpoint committed:'));
    const prepared = source.recoveryLog.find(({ text }) => /prepared in [\d.]+ ms/iu.test(text));
    source.recovery = {
      committed: Boolean(committed),
      ageMs: committed ? committed.at - editWallAt : null,
      prepareMs: Number(prepared?.text.match(/prepared in ([\d.]+) ms/iu)?.[1] ?? NaN),
      persistMs: Number(committed?.text.match(/persist ([\d.]+) ms/iu)?.[1] ?? NaN),
      artifactKiB: Number(committed?.text.match(/committed: ([\d]+) KiB/iu)?.[1] ?? NaN)
    };
    await viewportSamples(4);
    source.postCheckpointViewport = summarize(await viewportSamples(24));
    const checkpointCount = source.recoveryLog.filter(({ text }) => text.includes('Checkpoint committed:')).length;
    await viewportSamples(20);
    await delay(5_500);
    source.viewportOnlyAdditionalCheckpoints = source.recoveryLog
      .filter(({ text }) => text.includes('Checkpoint committed:')).length - checkpointCount;
    source.recoveryLongTasks = await page.evaluate(() => globalThis.__lightTableRecoveryLongTasks ?? []);
    source.recoveryLongTaskSummary = summarize(source.recoveryLongTasks.map(({ duration }) => duration));
    source.heapAfterBytes = await heap();
    source.heapDeltaBytes = source.heapAfterBytes === null || source.heapBeforeBytes === null
      ? null : source.heapAfterBytes - source.heapBeforeBytes;
    const recoveryDirectory = path.join(userData, 'recovery-v1');
    source.recoveryFiles = await Promise.all((await readdir(recoveryDirectory).catch(() => []))
      .filter((name) => name.endsWith('.ltrecovery')).map(async (name) => ({ name,
        bytes: (await stat(path.join(recoveryDirectory, name))).size })));
    if (!source.recovery.committed) throw new Error('Recovery checkpoint was not committed.');
    source.preCrashDocument = await driver.queryDocument(documentId);
    await driver.execute(documentId, 'view.setZoom', { mode: 'fit' });
    await frame(); await frame(); await delay(250);
    await hideFloatingLayersPanel(page);
    const preCrashCanvas = await page.locator('.lighttable-viewport__canvas').screenshot();
    await app.close();
    app = undefined;

    const restoreStarted = performance.now();
    app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
      cwd: workspace, env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
    const restoredPage = await app.firstWindow({ timeout: 30_000 });
    restoredPage.on('pageerror', (error) => source.pageErrors.push(error.stack ?? error.message));
    restoredPage.on('console', (message) => {
      if (message.type() === 'error') source.consoleErrors.push(message.text());
    });
    await waitForDesktopLauncher({
      app, page: restoredPage, outputDirectory: output, sourceFile,
      pageErrors: source.pageErrors, label: `recovery-restore-launcher-${index}`
    });
    const recoverButton = restoredPage.getByRole('button', { name: /Open recovered copy|Retry recovered copy/ });
    try {
      await recoverButton.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
      const diagnosticPath = await captureDesktopTestState({
        app, page: restoredPage, outputDirectory: output, sourceFile,
        pageErrors: source.pageErrors, label: `recovery-restore-missing-${index}`, timeout: 30_000,
        details: { recoveryFiles: source.recoveryFiles }
      });
      throw new Error(`Recovery action was unavailable. Diagnostic: ${diagnosticPath}`, { cause: error });
    }
    await recoverButton.click();
    await restoredPage.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: source.bytes > 100_000_000 ? 180_000 : 60_000 });
    source.restoreMs = performance.now() - restoreStarted;
    const restoredDriver = await attachLightTableAutomation(restoredPage, `recovery-restore-${index}`);
    const restoredDocumentId = (await restoredDriver.queryWorkspace())?.activeDocumentId;
    if (!restoredDocumentId) throw new Error('Recovery did not create an active document.');
    const restoredDocument = await restoredDriver.queryDocument(restoredDocumentId);
    await restoredDriver.execute(restoredDocumentId, 'view.setZoom', { mode: 'fit' });
    await restoredPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    })));
    await delay(250);
    await hideFloatingLayersPanel(restoredPage);
    const restoredCanvas = await restoredPage.locator('.lighttable-viewport__canvas').screenshot();
    await Promise.all([
      writeFile(path.join(output, `${index}-pre-crash.png`), preCrashCanvas),
      writeFile(path.join(output, `${index}-restored.png`), restoredCanvas)
    ]);
    const [normalizedPreCrash, normalizedRestored] = await Promise.all([
      normalizedCanvas(preCrashCanvas), normalizedCanvas(restoredCanvas)
    ]);
    const normalizedRmse = rmse(normalizedPreCrash, normalizedRestored);
    source.restore = {
      restoredDocument,
      layerCountMatches: restoredDocument?.layerCount === source.preCrashDocument?.layerCount,
      canvasMatches: restoredDocument?.canvas?.width === source.preCrashDocument?.canvas?.width
        && restoredDocument?.canvas?.height === source.preCrashDocument?.canvas?.height,
      preCrashCanvasSha256: sha256(preCrashCanvas),
      restoredCanvasSha256: sha256(restoredCanvas),
      normalizedRmse,
      pixelsMatch: normalizedRmse <= 8
    };
    source.status = source.recovery.committed && source.pageErrors.length === 0
      && source.viewportOnlyAdditionalCheckpoints === 0 && source.restore.layerCountMatches
      && source.restore.canvasMatches && source.restore.pixelsMatch ? 'passed' : 'failed';
  } catch (error) {
    source.status = 'failed'; source.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await app?.close().catch(() => undefined);
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
}

const assess = ({ status, baselineViewport, queuedViewport, recoveryViewport, postCheckpointViewport,
  baselineLongTasks, recoveryLongTaskSummary }) => {
    const allowed = Math.max(report.thresholds.p95ViewportMs,
      (baselineViewport?.p95Ms ?? 0) * report.thresholds.maximumRecoveryRegressionRatio);
    const allowedLongTask = Math.max(report.thresholds.maximumLongTaskMs,
      (baselineLongTasks?.maxMs ?? 0) * report.thresholds.maximumRecoveryRegressionRatio);
    return status === 'passed' && Math.max(queuedViewport?.p95Ms ?? 0, recoveryViewport?.p95Ms ?? 0,
      postCheckpointViewport?.p95Ms ?? 0) <= allowed
      && (recoveryLongTaskSummary?.maxMs ?? 0) <= allowedLongTask;
};
report.assessment = {
  passed: report.cases.every(assess),
  failedCases: report.cases.filter((item) => !assess(item)).map(({ path: file, error,
    baselineViewport, queuedViewport, recoveryViewport, postCheckpointViewport, recoveryLongTaskSummary }) => ({
    file, error, baselineP95Ms: baselineViewport?.p95Ms ?? null,
    queuedP95Ms: queuedViewport?.p95Ms ?? null, recoveryP95Ms: recoveryViewport?.p95Ms ?? null,
    postCheckpointP95Ms: postCheckpointViewport?.p95Ms ?? null,
    recoveryLongTaskMaxMs: recoveryLongTaskSummary?.maxMs ?? null
  }))
};
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (!report.assessment.passed) throw new Error(`Recovery qualification failed. Report: ${path.join(output, 'report.json')}`);
process.stdout.write(`Recovery qualification passed. Report: ${path.join(output, 'report.json')}\n`);
