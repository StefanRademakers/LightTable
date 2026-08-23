import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const sourceFile = path.resolve(argument(
  'file', 'D:/mediavibe/LightTableTestFiles/RandomFiles/VORTEXT.SVG'
));
const samples = Number.parseInt(argument('samples', '3'), 10);
const outputDirectory = path.resolve(argument(
  'output', path.join(root, 'tmp', 'quality-audit', 'warm-vortext-first-pixel')
));
assert.ok(Number.isInteger(samples) && samples > 0, '--samples must be a positive integer.');

const userData = path.join(outputDirectory, `user-data-${process.pid}`);
const warmFile = path.join(outputDirectory, 'warmup.svg');
await mkdir(userData, { recursive: true });
await writeFile(warmFile,
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="8" y="8" width="112" height="112" rx="16" fill="#2878e8"/><circle cx="64" cy="64" r="24" fill="#fff"/></svg>');
await writeFile(path.join(userData, 'recent-files.json'), JSON.stringify([
  { id: 'vortext', path: sourceFile, openedAt: 2 }
], null, 2));

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: warmFile
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: environment,
  timeout: 30_000
});
const report = {
  generatedAt: new Date().toISOString(), sourceFile, mode: launch.mode,
  executablePath: launch.executablePath, targetMs: 500, samples: [],
  pageErrors: [], consoleErrors: []
};

const waitForTimeline = async (driver, documentId, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  let timeline = null;
  while (Date.now() < deadline) {
    timeline = await driver.queryStartupTimeline(documentId);
    if (timeline?.complete) return timeline;
    await driver.page.waitForTimeout(8);
  }
  throw new Error(`Startup timeline did not complete: ${JSON.stringify(timeline)}`);
};

const canvasEvidence = async (page, screenshotPath) => {
  const bytes = await page.locator('.lighttable-viewport__canvas').screenshot({ path: screenshotPath });
  const { data, info } = await sharp(bytes).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let light = 0; let dark = 0; let mid = 0;
  const colors = new Set();
  for (let offset = 0; offset < data.length; offset += 3) {
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    const luminance = (r + g + b) / 3;
    if (luminance > 225) light += 1;
    if (luminance < 35) dark += 1;
    if (luminance >= 35 && luminance <= 225) mid += 1;
    if (colors.size < 65_536) colors.add(`${r},${g},${b}`);
  }
  const pixels = info.width * info.height;
  return {
    width: info.width, height: info.height,
    lightPixelRatio: light / pixels,
    darkPixelRatio: dark / pixels,
    midPixelRatio: mid / pixels,
    sampledUniqueColors: colors.size
  };
};

const openRecentFromEditor = async (page, name) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const recent = page.getByRole('menuitem', { name: 'Open Recent', exact: true });
  await recent.hover();
  await page.getByRole('menuitem', { name, exact: true }).last().click();
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapUsed = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const metrics = await cdp.send('Performance.getMetrics');
    return metrics.metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? null;
  };
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors: report.pageErrors
  });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'warm-vortext', 30_000);
  let workspace = await driver.queryWorkspace();
  const warmDocumentId = workspace.activeDocumentId;
  assert.ok(warmDocumentId, 'Warmup document did not open.');
  await driver.waitForRenderedDocument(warmDocumentId, 60_000);
  await waitForTimeline(driver, warmDocumentId, 60_000);
  report.heapBeforeBytes = await heapUsed();

  for (let index = 0; index < samples; index += 1) {
    const beforeIds = new Set((await driver.queryWorkspace()).documents.map(({ id }) => id));
    await openRecentFromEditor(page, path.basename(sourceFile));
    const deadline = Date.now() + 120_000;
    let documentId = null;
    while (Date.now() < deadline && !documentId) {
      workspace = await driver.queryWorkspace();
      documentId = workspace.documents.find(({ id }) => !beforeIds.has(id))?.id ?? null;
      if (!documentId) await page.waitForTimeout(8);
    }
    assert.ok(documentId, `VORTEXT sample ${index + 1} did not create a document.`);
    let timeline = await waitForTimeline(driver, documentId);
    await driver.waitForRenderedDocument(documentId, 120_000);
    const islandDeadline = Date.now() + 30_000;
    while (Date.now() < islandDeadline
      && !timeline.events.some(({ stage }) => stage === 'first-island-submission')) {
      await page.waitForTimeout(8);
      timeline = await driver.queryStartupTimeline(documentId);
    }
    const screenshot = path.join(outputDirectory, `vortext-sample-${index + 1}.png`);
    const evidence = await canvasEvidence(page, screenshot);
    const [document, renderTelemetry] = await Promise.all([
      driver.queryDocument(documentId),
      driver.queryRenderTelemetry(documentId)
    ]);
    const sampleRecord = {
      index: index + 1, documentId, timeline, evidence, screenshot,
      gpuBytes: document?.renderer?.estimatedGpuBytes ?? null,
      vectorBackend: renderTelemetry?.vectorBackend ?? null
    };
    report.samples.push(sampleRecord);
    assert.ok(evidence.midPixelRatio > 0.05 && evidence.darkPixelRatio > 0.05
      && evidence.sampledUniqueColors > 100,
    `Sample ${index + 1} did not show useful VORTEXT pixels: ${JSON.stringify(evidence)}`);
    await page.getByRole('button', { name: `Close ${path.basename(sourceFile)}`, exact: true }).click();
    await page.waitForFunction((id) => !window.__lightTableAutomation?.queryDocument(id), documentId);
    sampleRecord.heapAfterCloseBytes = await heapUsed();
  }

  assert.equal(report.pageErrors.length, 0, `Page errors: ${report.pageErrors.join(' | ')}`);
  assert.equal(report.consoleErrors.length, 0, `Console errors: ${report.consoleErrors.join(' | ')}`);
  const failures = report.samples.filter(({ timeline }) => timeline.firstPixelVisibleMs >= 500);
  assert.equal(failures.length, 0,
    `Warm VORTEXT exceeded 500 ms: ${failures.map(({ timeline }) => timeline.firstPixelVisibleMs).join(', ')}`);
  const gpuSamples = report.samples.map(({ gpuBytes }) => gpuBytes);
  assert.ok(gpuSamples.every((bytes) => bytes === gpuSamples[0]),
    `GPU estimates changed across equal VORTEXT cycles: ${gpuSamples.join(', ')}`);
  assert.ok(report.samples.every(({ vectorBackend }) =>
    vectorBackend?.active === 'vello' && vectorBackend.velloSurfaces === 1),
  'A canonical VORTEXT cycle did not finish on exactly one Vello island surface.');
  report.heapAfterBytes = await heapUsed();
  report.heapDeltaBytes = report.heapAfterBytes - report.heapBeforeBytes;
  report.steadyStateHeapDeltaBytes = report.samples.at(-1).heapAfterCloseBytes
    - report.samples[0].heapAfterCloseBytes;
  assert.ok(report.steadyStateHeapDeltaBytes < 16 * 1024 * 1024,
    `Repeated warm cycles retained ${report.steadyStateHeapDeltaBytes} steady-state JS heap bytes.`);
  report.passed = true;
} catch (reason) {
  report.passed = false;
  report.failure = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  throw reason;
} finally {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
