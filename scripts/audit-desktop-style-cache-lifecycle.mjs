import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import {
  resolveDesktopTestLaunch,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]);
const sourceLayerId = Number(process.argv[3]);
const runLabel = process.argv[4] ?? 'style-cache';
const zoomPercent = process.argv[5] === undefined ? null : Number(process.argv[5]);
if (!sourceFile || !Number.isInteger(sourceLayerId)) {
  throw new Error('Usage: audit-desktop-style-cache-lifecycle.mjs <file> <PSD source layer id> [label]');
}
const outputDirectory = path.join(workspaceRoot, 'tmp', 'style-cache-lifecycle-audit');
const reportPath = path.join(outputDirectory, `${runLabel}.json`);
const hiddenScreenshotPath = path.join(outputDirectory, `${runLabel}-hidden.png`);
const visibleScreenshotPath = path.join(outputDirectory, `${runLabel}-visible.png`);
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}-${runLabel}`);
const launch = await resolveDesktopTestLaunch(workspaceRoot);
await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);

const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const report = {
  schema: 2,
  generatedAt: new Date().toISOString(),
  launchMode: launch.mode,
  sourceFile,
  sourceLayerId,
  runLabel,
  cycles: [],
  pageErrors: [],
  consoleErrors: []
};
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
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  const openFileButton = await waitForDesktopLauncher({
    app,
    page,
    outputDirectory,
    sourceFile,
    pageErrors: report.pageErrors,
    label: 'style-cache-lifecycle'
  });
  await openFileButton.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'style-cache-lifecycle');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const target = (await driver.queryLayers(documentId))
    ?.find(({ id }) => id === `psd-layer-${sourceLayerId}`);
  if (!target) throw new Error(`PSD layer ${sourceLayerId} was not found.`);
  const effects = await driver.queryLayerEffects(documentId, target.id);
  if (!effects?.enabled || !effects.effects.some(({ enabled }) => enabled)) {
    throw new Error(`PSD layer ${sourceLayerId} has no enabled Layer Style.`);
  }
  if (zoomPercent !== null) {
    if (!Number.isFinite(zoomPercent) || zoomPercent <= 0) throw new Error('Zoom percent must be positive.');
    await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: zoomPercent });
  }
  await page.waitForTimeout(400);
  const canvas = page.locator('.lighttable-viewport__canvas');
  const settle = async () => {
    let previous = -1;
    let stable = 0;
    const startedAt = performance.now();
    while (performance.now() - startedAt < 2_000 && stable < 3) {
      await page.waitForTimeout(16);
      const bytes = (await driver.queryDocument(documentId))?.renderer.estimatedGpuBytes ?? 0;
      stable = bytes === previous ? stable + 1 : 0;
      previous = bytes;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { durationMs: performance.now() - startedAt, estimatedGpuBytes: previous };
  };
  const initial = await settle();
  let visibleReference = null;
  for (let cycle = 0; cycle < 6; cycle += 1) {
    const hideStartedAt = performance.now();
    await driver.execute(documentId, 'layer.setVisibility', { layerIds: [target.id], visible: false });
    if ((await driver.queryLayers(documentId))?.find(({ id }) => id === target.id)?.visible !== false) {
      throw new Error('The target layer did not become hidden.');
    }
    const hidden = await settle();
    hidden.wallMs = performance.now() - hideStartedAt;
    const hiddenScreenshot = await canvas.screenshot();
    hidden.screenshotHash = hash(hiddenScreenshot);
    if (cycle === 0) await writeFile(hiddenScreenshotPath, hiddenScreenshot);

    const showStartedAt = performance.now();
    await driver.execute(documentId, 'layer.setVisibility', { layerIds: [target.id], visible: true });
    if ((await driver.queryLayers(documentId))?.find(({ id }) => id === target.id)?.visible !== true) {
      throw new Error('The target layer did not become visible.');
    }
    const visible = await settle();
    visible.wallMs = performance.now() - showStartedAt;
    const visibleScreenshot = await canvas.screenshot();
    visible.screenshotHash = hash(visibleScreenshot);
    if (cycle === 0) await writeFile(visibleScreenshotPath, visibleScreenshot);
    visibleReference ??= visible.screenshotHash;
    report.cycles.push({
      cycle: cycle + 1,
      hidden,
      visible,
      releasedBytes: visible.estimatedGpuBytes - hidden.estimatedGpuBytes,
      visibleMatchesReference: visible.screenshotHash === visibleReference
    });
  }
  report.initial = initial;
  report.runtimeStopped = /document runtime stopped unexpectedly/i.test(await page.locator('body').innerText());
  if (report.pageErrors.length || report.consoleErrors.length || report.runtimeStopped) {
    throw new Error('Style cache lifecycle runtime failure.');
  }
  if (report.cycles.some(({ visibleMatchesReference }) => !visibleMatchesReference)) {
    throw new Error('A restored styled layer did not reproduce the reference viewport.');
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Style cache lifecycle audit passed. Report: ${reportPath}\n`);
