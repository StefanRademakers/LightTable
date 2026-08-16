import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const runLabel = process.argv[3] ?? 'baseline';
const outputDirectory = path.join(workspaceRoot, 'tmp', 'effect-lifecycle-audit');
const reportPath = path.join(outputDirectory, `${runLabel}.json`);
const screenshotDirectory = path.join(outputDirectory, runLabel);
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}-${runLabel}`);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

await Promise.all([
  access(sourceFile),
  access(executablePath),
  mkdir(screenshotDirectory, { recursive: true }),
  mkdir(userDataPath, { recursive: true })
]);

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  runLabel,
  sourceFile,
  effects: [],
  pageErrors: [],
  consoleErrors: [],
  longTasks: []
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

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'effect-lifecycle');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  // Document adjustments require a raster/Grade owner. Prefer an existing,
  // currently presented raster layer so visual fidelity is exercised too;
  // fall back to an isolated raster only for vector-only fixtures.
  const layers = await driver.queryLayers(documentId) ?? [];
  const presentedLayerIds = new Set(await page.locator('[data-layer-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-layer-id')).filter(Boolean)
  ));
  const rasterOwner = layers.find((layer) => (
    layer.type === 'raster' && layer.visible && presentedLayerIds.has(layer.id)
  ));
  if (rasterOwner) {
    const selectorId = rasterOwner.id.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    await page.locator(`[data-layer-id="${selectorId}"]`).click();
  } else {
    await driver.execute(documentId, 'layer.createRaster', {});
  }

  await page.evaluate(() => {
    globalThis.__lightTableEffectAudit = { longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableEffectAudit.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  await page.locator('.lighttable-layer--active').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit Local Lens Fx', exact: true }).click();
  await page.getByRole('tab', { name: 'Properties', exact: true }).waitFor({ state: 'visible' });
  const viewport = page.locator('.lighttable-viewport');
  const settle = async (previousBytes, expectDirection) => {
    const startedAt = performance.now();
    let lastBytes = previousBytes;
    let stableSamples = 0;
    while (performance.now() - startedAt < 1_500) {
      await page.waitForTimeout(16);
      const current = await driver.queryDocument(documentId);
      const bytes = current?.renderer.estimatedGpuBytes ?? lastBytes;
      const moved = expectDirection === 'up' ? bytes > previousBytes : bytes < previousBytes;
      stableSamples = bytes === lastBytes && moved ? stableSamples + 1 : 0;
      lastBytes = bytes;
      if (stableSamples >= 3) break;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return {
      durationMs: performance.now() - startedAt,
      estimatedGpuBytes: lastBytes,
      changedAsExpected: expectDirection === 'up'
        ? lastBytes > previousBytes
        : lastBytes < previousBytes
    };
  };
  const capture = async (name) => {
    const buffer = await viewport.screenshot({ path: path.join(screenshotDirectory, `${name}.png`) });
    return hash(buffer);
  };

  for (const effect of ['Lens Distortion', 'Chromatic Aberration', 'Halation', 'Grain']) {
    const toggle = page.getByRole('switch', { name: new RegExp(effect) });
    const before = await driver.queryDocument(documentId);
    const beforeBytes = before?.renderer.estimatedGpuBytes ?? 0;
    const cycles = [];
    let referenceHash = null;
    for (let cycle = 0; cycle < 6; cycle += 1) {
      const enabledStartedAt = performance.now();
      await toggle.click();
      const enabled = await settle(beforeBytes, 'up');
      const enabledWallMs = performance.now() - enabledStartedAt;
      const enabledHash = await capture(`${effect.replaceAll(' ', '-').toLowerCase()}-${cycle}-enabled`);
      referenceHash ??= enabledHash;

      const disabledStartedAt = performance.now();
      await toggle.click();
      const disabled = await settle(enabled.estimatedGpuBytes, 'down');
      const disabledHash = await capture(`${effect.replaceAll(' ', '-').toLowerCase()}-${cycle}-disabled`);
      cycles.push({
        cycle: cycle + 1,
        enabled: { ...enabled, wallMs: enabledWallMs, screenshotHash: enabledHash },
        disabled: {
          ...disabled,
          wallMs: performance.now() - disabledStartedAt,
          screenshotHash: disabledHash
        },
        enabledMatchesReference: enabledHash === referenceHash,
        enabledDiffersFromDisabled: enabledHash !== disabledHash
      });
    }
    const warm = cycles.slice(1).map(({ enabled }) => enabled.wallMs);
    report.effects.push({
      effect,
      baselineGpuBytes: beforeBytes,
      cycles,
      coldEnableMs: cycles[0]?.enabled.wallMs ?? null,
      warmEnableMedianMs: percentile(warm, 0.5),
      warmEnableP95Ms: percentile(warm, 0.95),
      peakGpuDeltaBytes: Math.max(0, ...cycles.map(({ enabled }) => enabled.estimatedGpuBytes - beforeBytes)),
      fidelityStable: cycles.every(({ enabledMatchesReference }) => enabledMatchesReference),
      effectVisuallyObserved: cycles.some(({ enabledDiffersFromDisabled }) => enabledDiffersFromDisabled)
    });
  }

  report.longTasks = await page.evaluate(() => globalThis.__lightTableEffectAudit.longTasks);
  report.finalDocument = await driver.queryDocument(documentId);
  const runtimeStopped = /document runtime stopped unexpectedly/i.test(await page.locator('body').innerText());
  report.runtimeStopped = runtimeStopped;
  if (report.pageErrors.length || report.consoleErrors.length || runtimeStopped) {
    throw new Error(`Effect lifecycle audit failed: ${JSON.stringify({
      pageErrors: report.pageErrors,
      consoleErrors: report.consoleErrors,
      runtimeStopped
    })}`);
  }
  if (report.effects.some(({ fidelityStable }) => !fidelityStable)) {
    throw new Error('An enabled effect did not reproduce a pixel-identical warm result.');
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Effect lifecycle audit passed. Report: ${reportPath}\n`);
