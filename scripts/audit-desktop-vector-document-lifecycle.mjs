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
const expectedBackend = 'hybrid';
const profileFirstClose = argument('profile-first-close', 'false') === 'true';
const directClick = argument('direct-click', 'true') === 'true';
const outputDirectory = path.resolve(argument(
  'output', path.join(root, 'tmp', 'quality-audit', 'vector-document-lifecycle')
));
assert.ok(sourceFile, 'Usage: audit-desktop-vector-document-lifecycle.mjs --file <SVG>');
assert.ok(Number.isInteger(cycles) && cycles >= 3, '--cycles must be at least 3.');

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

const summarizeCpuProfile = (profile) => {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const selfTime = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const nodeId = profile.samples[index];
    if (!nodes.has(nodeId)) continue;
    selfTime.set(nodeId, (selfTime.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  const frame = ({ functionName, url, lineNumber }) => ({
    functionName: functionName || '(anonymous)', url, line: lineNumber + 1
  });
  return [...selfTime].map(([nodeId, microseconds]) => {
    const stack = [];
    for (let current = nodeId; current && stack.length < 16; current = parents.get(current)) {
      const node = nodes.get(current);
      if (node) stack.push(frame(node.callFrame));
    }
    return { ...frame(nodes.get(nodeId).callFrame), selfMs: microseconds / 1000, stack };
  }).sort((left, right) => right.selfMs - left.selfMs).slice(0, 40);
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
  report.layers = await driver.queryLayers(first.document.id);

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const workspace = await driver.queryWorkspace();
    const closingId = workspace?.activeDocumentId;
    assert.ok(closingId, `Cycle ${cycle} has no active document to close.`);
    const closeTimeline = {
      dialogSeenMs: null, dialogAcceptMs: null, clickReturnMs: null, stateCommitMs: null
    };
    let closeStartedAt = 0;
    page.once('dialog', async dialog => {
      closeTimeline.dialogSeenMs = performance.now() - closeStartedAt;
      const acceptStartedAt = performance.now();
      await dialog.accept();
      closeTimeline.dialogAcceptMs = performance.now() - acceptStartedAt;
    });
    if (profileFirstClose && cycle === 1) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    closeStartedAt = performance.now();
    const closeButton = page.locator('.lighttable-document-tab--active .lighttable-document-tab__close');
    if (directClick) await closeButton.evaluate(element => element.click());
    else await closeButton.click();
    closeTimeline.clickReturnMs = performance.now() - closeStartedAt;
    const closeDeadline = Date.now() + 30_000;
    let closedWorkspace = await driver.queryWorkspace();
    while (closedWorkspace?.activeDocumentId === closingId && Date.now() < closeDeadline) {
      await page.waitForTimeout(25);
      closedWorkspace = await driver.queryWorkspace();
    }
    assert.notEqual(closedWorkspace?.activeDocumentId, closingId, `Cycle ${cycle} did not close.`);
    const closeMs = performance.now() - closeStartedAt;
    closeTimeline.stateCommitMs = closeMs;
    if (profileFirstClose && cycle === 1) {
      const { profile } = await cdp.send('Profiler.stop');
      report.firstCloseCpuProfile = summarizeCpuProfile(profile);
    }

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
      cycle, closeMs, closeTimeline, openMs,
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
