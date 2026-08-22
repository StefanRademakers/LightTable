import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const sourceFile = path.resolve(argument('file') ?? '');
const cycles = Number.parseInt(argument('cycles', '6'), 10);
const expectedBackend = argument('expected-backend');
const outputDirectory = path.resolve(argument(
  'output', path.join(root, 'tmp', 'quality-audit', 'vector-document-lifecycle')
));
assert.ok(sourceFile, 'Usage: audit-desktop-vector-document-lifecycle.mjs --file <SVG>');
assert.ok(Number.isInteger(cycles) && cycles >= 3, '--cycles must be at least 3.');
assert.ok(['current', 'vello'].includes(expectedBackend), '--expected-backend must be current or vello.');

const launch = await resolveDesktopTestLaunch(root);
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');
await mkdir(userDataPath, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const report = {
  generatedAt: new Date().toISOString(), sourceFile, cycles, expectedBackend,
  mode: launch.mode, executablePath: launch.executablePath,
  samples: [], pageErrors: [], consoleErrors: []
};
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => report.pageErrors.push(error.stack ?? error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  const open = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile,
    pageErrors: report.pageErrors, label: 'vector-document-lifecycle'
  });
  await open.click();
  const driver = await attachLightTableAutomation(page, 'vector-document-lifecycle');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapUsed = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const metrics = await cdp.send('Performance.getMetrics');
    return metrics.metrics.find(entry => entry.name === 'JSHeapUsedSize')?.value ?? null;
  };
  const activeRenderedDocument = async () => {
    const deadline = Date.now() + 90_000;
    let workspace = await driver.queryWorkspace();
    while (!workspace?.activeDocumentId && Date.now() < deadline) {
      await page.waitForTimeout(25);
      workspace = await driver.queryWorkspace();
    }
    assert.ok(workspace?.activeDocumentId, 'No active document appeared after opening the source.');
    return driver.waitForRenderedDocument(workspace.activeDocumentId, 90_000);
  };
  const first = await activeRenderedDocument();
  report.before = {
    heapUsedBytes: await heapUsed(),
    renderer: first.document.renderer,
    vectorBackend: first.telemetry.vectorBackend ?? null
  };

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const workspace = await driver.queryWorkspace();
    const closingId = workspace?.activeDocumentId;
    assert.ok(closingId, `Cycle ${cycle} has no active document to close.`);
    page.once('dialog', dialog => dialog.accept());
    const closeStartedAt = performance.now();
    await page.locator('.lighttable-document-tab--active .lighttable-document-tab__close').click();
    const closeDeadline = Date.now() + 30_000;
    let closedWorkspace = await driver.queryWorkspace();
    while (closedWorkspace?.activeDocumentId === closingId && Date.now() < closeDeadline) {
      await page.waitForTimeout(25);
      closedWorkspace = await driver.queryWorkspace();
    }
    assert.notEqual(closedWorkspace?.activeDocumentId, closingId, `Cycle ${cycle} did not close.`);
    const closeMs = performance.now() - closeStartedAt;

    const openStartedAt = performance.now();
    const launcherOpen = page.getByRole('button', { name: 'Open', exact: true });
    if (await launcherOpen.isVisible().catch(() => false)) await launcherOpen.click();
    else {
      await page.locator('.shots-app-menu__button').filter({ hasText: /^File$/u }).click();
      await page.locator('.context-menu:visible').getByRole('menuitem', { name: 'Open', exact: true }).click();
    }
    const reopened = await activeRenderedDocument();
    const openMs = performance.now() - openStartedAt;
    report.samples.push({
      cycle, closeMs, openMs,
      documentId: reopened.document.id,
      lifecycle: reopened.document.lifecycle,
      renderer: reopened.document.renderer,
      vectorBackend: reopened.telemetry.vectorBackend ?? null,
      heapUsedBytes: await heapUsed()
    });
  }
  const last = report.samples.at(-1);
  report.summary = {
    heapDeltaBytes: last.heapUsedBytes - report.before.heapUsedBytes,
    gpuDeltaBytes: last.renderer.estimatedGpuBytes - report.before.renderer.estimatedGpuBytes,
    distinctDocumentIds: new Set(report.samples.map(sample => sample.documentId)).size,
    maximumOpenMs: Math.max(...report.samples.map(sample => sample.openMs)),
    maximumCloseMs: Math.max(...report.samples.map(sample => sample.closeMs))
  };
  const debugText = await page.locator('body').innerText();
  report.runtimeStopped = /document runtime stopped unexpectedly/iu.test(debugText);
  if (report.samples.some(sample => sample.lifecycle !== 'ready' || !sample.renderer.active)) {
    throw new Error('A reopened document failed to reach a ready active renderer.');
  }
  if (report.before.vectorBackend?.selected !== expectedBackend
    || report.samples.some(sample => sample.vectorBackend?.selected !== expectedBackend)) {
    throw new Error(`A cycle did not retain the ${expectedBackend} backend.`);
  }
  if (report.summary.distinctDocumentIds !== cycles) {
    throw new Error('A reopened source reused a closed document session identity.');
  }
  if (report.summary.gpuDeltaBytes !== 0) {
    throw new Error(`GPU resource estimate changed across cycles: ${report.summary.gpuDeltaBytes} bytes.`);
  }
  if (report.summary.heapDeltaBytes > 5 * 1024 * 1024) {
    throw new Error(`Heap retention exceeded 5 MiB: ${report.summary.heapDeltaBytes} bytes.`);
  }
  if (report.pageErrors.length || report.consoleErrors.length || report.runtimeStopped) {
    throw new Error('Vector document lifecycle audit observed a runtime failure.');
  }
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await app.close().catch(() => {});
}

process.stdout.write(`Vector document lifecycle audit passed. Report: ${reportPath}\n`);
