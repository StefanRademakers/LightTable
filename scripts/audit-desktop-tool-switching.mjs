import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const fixture = path.resolve(argument('file', 'D:\\shapes.psd'));
const iterations = Math.max(3, Number.parseInt(argument('iterations', '10'), 10) || 10);
const executable = path.resolve(argument('executable',
  path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe')));
const output = path.resolve(argument('output',
  path.join(workspace, 'tmp', 'quality-audit', 'tool-switching')));
const reportPath = path.join(output, 'report.json');
const userData = path.join(output, `user-data-${process.pid}`);
await Promise.all([access(fixture), access(executable), mkdir(userData, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: executable,
  args: [path.join(workspace, 'apps', 'desktop')],
  cwd: workspace,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture,
    LIGHTTABLE_AUTOMATION_USER_DATA: userData
  },
  timeout: 30_000
});

const samples = [];
const pageErrors = [];
const consoleErrors = [];
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  await Promise.all([cdp.send('Performance.enable'), cdp.send('HeapProfiler.enable')]);
  await page.evaluate(() => {
    globalThis.__lightTableToolSwitchLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__lightTableToolSwitchLongTasks.push({
          startTime: entry.startTime, duration: entry.duration
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  const switchEveryTool = async () => {
    const directLabels = await page.locator(
      '.lighttable-toolbox__content > .lighttable-toolbox__button'
    ).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')).filter(Boolean));
    const familyLabels = await page.locator(
      '.lighttable-toolbox__group > .lighttable-toolbox__group-menu-button'
    ).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')).filter(Boolean));
    const visited = [];
    for (const label of directLabels) {
      await page.getByRole('button', { name: label, exact: true }).click();
      visited.push(label);
    }
    for (const familyLabel of familyLabels) {
      await page.getByRole('button', { name: familyLabel, exact: true }).click();
      const flyout = page.locator('.lighttable-toolbox__flyout:visible');
      const labels = await flyout.getByRole('button').evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')).filter(Boolean));
      for (const label of labels) {
        await page.getByRole('button', { name: familyLabel, exact: true }).click();
        await page.locator('.lighttable-toolbox__flyout:visible')
          .getByRole('button', { name: label, exact: true }).click();
        visited.push(label);
      }
    }
    return [...new Set(visited)];
  };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    const visited = await switchEveryTool();
    await page.waitForTimeout(50);
    await cdp.send('HeapProfiler.collectGarbage');
    const [metrics, dom, runtime] = await Promise.all([
      cdp.send('Performance.getMetrics'),
      cdp.send('Memory.getDOMCounters'),
      page.evaluate(() => ({
        stopped: /document runtime stopped unexpectedly/i.test(document.body.innerText),
        active: document.querySelector('.lighttable-toolbox__button[aria-pressed="true"]')
          ?.getAttribute('aria-label') ?? null,
        longTasks: globalThis.__lightTableToolSwitchLongTasks ?? []
      }))
    ]);
    const metric = (name) => metrics.metrics.find((entry) => entry.name === name)?.value ?? null;
    samples.push({
      iteration, visited, durationMs: Math.round((performance.now() - started) * 10) / 10,
      heapBytes: metric('JSHeapUsedSize'), domNodes: dom.nodes,
      listeners: dom.jsEventListeners, active: runtime.active, stopped: runtime.stopped,
      longTaskCount: runtime.longTasks.length,
      longestTaskMs: Math.max(0, ...runtime.longTasks.map(({ duration }) => duration))
    });
    if (visited.length < 20) throw new Error(`Only ${visited.length} tools were reachable.`);
    if (runtime.stopped) throw new Error(`Document runtime stopped in iteration ${iteration}.`);
  }

  const tail = samples.slice(Math.floor(samples.length / 2));
  const first = tail[0]; const last = tail.at(-1);
  const minimumHeap = Math.min(...tail.map(({ heapBytes }) => heapBytes));
  const assessment = {
    heapGrowthBytes: last.heapBytes - minimumHeap,
    domGrowth: last.domNodes - first.domNodes,
    listenerGrowth: last.listeners - first.listeners,
    maximumIterationMs: Math.max(...samples.map(({ durationMs }) => durationMs)),
    maximumLongTaskMs: Math.max(...samples.map(({ longestTaskMs }) => longestTaskMs))
  };
  const failures = [];
  if (assessment.heapGrowthBytes > 64 * 1024 * 1024) failures.push('post-GC heap grew over 64 MiB');
  if (assessment.domGrowth > 64) failures.push('DOM grew over 64 nodes');
  if (assessment.listenerGrowth > 64) failures.push('listeners grew over 64');
  if (pageErrors.length) failures.push(`${pageErrors.length} page error(s)`);
  if (consoleErrors.length) failures.push(`${consoleErrors.length} console error(s)`);
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1, fixture, iterations, samples, assessment, pageErrors,
    consoleErrors, failures
  }, null, 2)}\n`, 'utf8');
  if (failures.length) throw new Error(`Tool-switch audit failed: ${failures.join(', ')}.`);
  process.stdout.write(`Tool-switch audit passed (${samples[0].visited.length} tools, ${iterations} rounds). Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
