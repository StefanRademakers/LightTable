import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const desktopAppPath = path.join(workspaceRoot, 'apps', 'desktop');
const defaultExecutable = path.join(
  workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe'
);

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const argumentsFor = (name) => process.argv.flatMap((value, index) =>
  value === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []
);

const defaultFiles = [
  'D:\\TextTest.psd',
  'D:\\shapes.psd',
  'D:\\FormulierPersoneel.pdf'
];
const requestedFiles = argumentsFor('file');
const files = (requestedFiles.length ? requestedFiles : defaultFiles).map((file) => path.resolve(file));
const iterations = Math.max(2, Number.parseInt(argument('iterations', '6'), 10) || 6);
const skipPaint = argument('skip-paint', 'false') === 'true';
const diagnoseDom = argument('diagnose-dom', 'false') === 'true';
const actionSet = new Set(argument('actions', 'layers,zoom,pan,panels,paint')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const outputFile = path.resolve(argument(
  'output',
  path.join(workspaceRoot, 'tmp', 'stress', 'desktop-editor-stress.json')
));
const executablePath = path.resolve(argument('executable', defaultExecutable));
const screenshotDirectory = path.join(path.dirname(outputFile), 'screenshots');
const userDataPath = path.join(
  workspaceRoot,
  'tmp',
  `playwright-stress-user-data-${process.pid}`
);

await access(executablePath).catch((error) => {
  throw new Error(`Packaged desktop executable is missing. Build it before stress testing.\n${error}`);
});
for (const file of files) {
  await access(file).catch((error) => {
    throw new Error(`Stress input is missing: ${file}\n${error}`);
  });
}
await Promise.all([
  mkdir(path.dirname(outputFile), { recursive: true }),
  mkdir(screenshotDirectory, { recursive: true }),
  mkdir(userDataPath, { recursive: true })
]);

const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

const bytes = (value) => Number.isFinite(value) ? Math.round(value) : null;
const metricValue = (metrics, name) => metrics.find((metric) => metric.name === name)?.value ?? null;
const gpuBytesFrom = (text) => {
  const match = text.match(/GPU\s*~?\s*(\d+(?:\.\d+)?)\s*MB/i);
  return match ? Math.round(Number(match[1]) * 1024 * 1024) : null;
};

const growthAssessment = (samples) => {
  const settled = samples.slice(1);
  if (settled.length < 2) return { suspicious: false, reasons: [] };
  const first = settled[0];
  const last = settled.at(-1);
  const tailSize = Math.max(2, Math.min(settled.length, Math.ceil(settled.length / 3)));
  const tail = settled.slice(-tailSize);
  const tailFirst = tail[0];
  const minimumHeap = Math.min(...tail.map(({ jsHeapUsedBytes }) => jsHeapUsedBytes ?? Infinity));
  const heapGrowth = last.jsHeapUsedBytes == null || !Number.isFinite(minimumHeap)
    ? null
    : last.jsHeapUsedBytes - minimumHeap;
  const heapRatio = heapGrowth == null || minimumHeap <= 0 ? null : heapGrowth / minimumHeap;
  const domGrowth = last.domNodes - tailFirst.domNodes;
  const listenerGrowth = last.eventListeners == null || tailFirst.eventListeners == null
    ? null
    : last.eventListeners - tailFirst.eventListeners;
  const debugMessageGrowth = last.debugMessageCount - tailFirst.debugMessageCount;
  const unexplainedDomGrowth = domGrowth - Math.max(0, debugMessageGrowth) * 32;
  const gpuValues = tail.map(({ gpuBytes }) => gpuBytes).filter(Number.isFinite);
  const gpuGrowth = gpuValues.length >= 2 ? gpuValues.at(-1) - Math.min(...gpuValues) : null;
  const reasons = [];
  if (heapGrowth != null && heapGrowth > 96 * 1024 * 1024 && heapRatio > 0.5) {
    reasons.push(`post-GC JavaScript heap grew by ${Math.round(heapGrowth / 1024 / 1024)} MiB`);
  }
  if (unexplainedDomGrowth > 64) {
    reasons.push(
      `DOM node count grew by ${domGrowth} (${unexplainedDomGrowth} outside the bounded debug log)`
    );
  }
  if (listenerGrowth != null && listenerGrowth > 64) {
    reasons.push(`event listener count grew by ${listenerGrowth}`);
  }
  if (gpuGrowth != null && gpuGrowth > 128 * 1024 * 1024) {
    reasons.push(`reported GPU memory grew by ${Math.round(gpuGrowth / 1024 / 1024)} MiB`);
  }
  return {
    suspicious: reasons.length > 0,
    reasons,
    heapGrowthBytes: bytes(heapGrowth),
    heapGrowthRatio: heapRatio,
    domGrowth,
    debugMessageGrowth,
    unexplainedDomGrowth,
    listenerGrowth,
    gpuGrowthBytes: bytes(gpuGrowth),
    overall: {
      heapGrowthBytes: first.jsHeapUsedBytes == null || last.jsHeapUsedBytes == null
        ? null
        : last.jsHeapUsedBytes - first.jsHeapUsedBytes,
      domGrowth: last.domNodes - first.domNodes,
      listenerGrowth: first.eventListeners == null || last.eventListeners == null
        ? null
        : last.eventListeners - first.eventListeners,
      gpuGrowthBytes: first.gpuBytes == null || last.gpuBytes == null
        ? null
        : last.gpuBytes - first.gpuBytes
    }
  };
};

const collectMetrics = async (window, cdp, iteration) => {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await window.waitForTimeout(100);
  const [performanceResult, domCounters, runtime] = await Promise.all([
    cdp.send('Performance.getMetrics'),
    cdp.send('Memory.getDOMCounters').catch(() => ({ documents: null, nodes: null, jsEventListeners: null })),
    window.evaluate((includeClassCounts) => {
      const metadata = document.querySelector('.lighttable-toolbar__meta');
      const bodyText = document.body.innerText;
      const classCounts = {};
      if (includeClassCounts) {
        document.querySelectorAll('[class]').forEach((element) => {
          for (const name of element.classList) classCounts[name] = (classCounts[name] ?? 0) + 1;
        });
      }
      return {
        canvasCount: document.querySelectorAll('canvas').length,
        imageCount: document.querySelectorAll('img').length,
        liveDomNodes: document.querySelectorAll('*').length,
        debugMessageCount: document.querySelectorAll('.lighttable-debug-message').length,
        layerCount: document.querySelectorAll('.lighttable-layer').length,
        metadata: metadata?.textContent?.trim() ?? '',
        metadataTitle: metadata?.getAttribute('title') ?? '',
        status: document.querySelector('.lighttable-toolbar__status')?.textContent?.trim() ?? '',
        runtimeStopped: /document runtime stopped unexpectedly/i.test(bodyText),
        invalidHookOrder: /hooks conditionally|should have a queue|invalid hook call/i.test(bodyText),
        classCounts
      };
    }, diagnoseDom)
  ]);
  return {
    iteration,
    jsHeapUsedBytes: bytes(metricValue(performanceResult.metrics, 'JSHeapUsedSize')),
    jsHeapTotalBytes: bytes(metricValue(performanceResult.metrics, 'JSHeapTotalSize')),
    documents: domCounters.documents,
    domNodes: domCounters.nodes,
    eventListeners: domCounters.jsEventListeners,
    gpuBytes: gpuBytesFrom(`${runtime.metadata} ${runtime.metadataTitle}`),
    ...runtime
  };
};

const clickToolIfPresent = async (window, name) => {
  const button = window.getByRole('button', { name }).first();
  if (await button.count()) await button.click();
};

const exerciseDocument = async (window, iteration, actions) => {
  const layers = window.locator('.lighttable-layer');
  const baselineLayerCount = await layers.count();
  if (baselineLayerCount < 1) throw new Error('The loaded document has no layer rows.');

  if (actionSet.has('layers') || actionSet.has('select') || actionSet.has('visibility')) {
    const selectedIndex = iteration % baselineLayerCount;
    const selected = layers.nth(selectedIndex);
    if (actionSet.has('layers') || actionSet.has('select')) {
      await selected.click();
      actions.push({ iteration, action: 'select-layer', index: selectedIndex });
    }

    if (actionSet.has('layers') || actionSet.has('visibility')) {
      const visibility = selected.locator('.lighttable-layer__visibility');
      if (await visibility.count()) {
        await visibility.click();
        await visibility.click();
        actions.push({ iteration, action: 'toggle-visibility-roundtrip', index: selectedIndex });
      }
    }
  }

  if (actionSet.has('zoom')) {
    await window.keyboard.press('Control+Equal');
    await window.keyboard.press('Control+Minus');
    await window.keyboard.press('Control+0');
    actions.push({ iteration, action: 'zoom-roundtrip' });
  }

  if (actionSet.has('panels')) {
    for (const tabName of ['Lens Fx', 'Debug', 'Grade']) {
      const tab = window.getByRole('tab', { name: tabName, exact: true });
      if (await tab.count()) await tab.click();
    }
    actions.push({ iteration, action: 'panel-tab-roundtrip' });
  }

  const viewport = window.locator('.lighttable-viewport');
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error('The document viewport has no interactive bounds.');
  if (actionSet.has('pan')) {
    await clickToolIfPresent(window, /Move canvas/i);
    const panX = viewportBox.x + viewportBox.width * 0.48;
    const panY = viewportBox.y + viewportBox.height * 0.48;
    await window.mouse.move(panX, panY);
    await window.mouse.down();
    await window.mouse.move(panX + 18, panY + 12, { steps: 4 });
    await window.mouse.up();
    await window.keyboard.press('Control+0');
    actions.push({ iteration, action: 'pan-roundtrip' });
  }

  if (!skipPaint && actionSet.has('paint')) {
    await window.getByRole('button', { name: 'New raster layer' }).click();
    await window.waitForFunction(
      (expected) => document.querySelectorAll('.lighttable-layer').length === expected,
      baselineLayerCount + 1,
      { timeout: 15_000 }
    );
    await clickToolIfPresent(window, /Brush \(B\)/i);
    const paintBox = await viewport.boundingBox();
    if (!paintBox) throw new Error('The document viewport disappeared during painting.');
    const paintX = paintBox.x + paintBox.width * (0.35 + (iteration % 3) * 0.08);
    const paintY = paintBox.y + paintBox.height * (0.40 + (iteration % 2) * 0.08);
    await window.mouse.move(paintX, paintY);
    await window.mouse.down();
    await window.mouse.move(paintX + 40, paintY + 12, { steps: 8 });
    await window.mouse.up();
    actions.push({ iteration, action: 'temporary-paint-stroke' });

    await window.getByRole('button', { name: 'Delete layer or mask' }).click();
    await window.waitForFunction(
      (expected) => document.querySelectorAll('.lighttable-layer').length === expected,
      baselineLayerCount,
      { timeout: 15_000 }
    );
    actions.push({ iteration, action: 'delete-temporary-layer' });
  }

  await clickToolIfPresent(window, /Path selection/i);
  await window.waitForTimeout(100);
  return baselineLayerCount;
};

const runFile = async (sourceFile, fileIndex) => {
  const result = {
    sourceFile,
    iterations,
    saveCommandsIssued: 0,
    actions: [],
    console: [],
    pageErrors: [],
    samples: [],
    failures: []
  };
  let electronApp;
  let window;
  try {
    electronApp = await electron.launch({
      executablePath,
      args: [desktopAppPath, '--js-flags=--expose-gc'],
      cwd: workspaceRoot,
      env: {
        ...launchEnvironment,
        LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
        LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
      },
      timeout: 30_000
    });
    window = await electronApp.firstWindow({ timeout: 30_000 });
    window.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        result.console.push({ type: message.type(), text: message.text() });
      }
    });
    window.on('pageerror', (error) => result.pageErrors.push(error.stack ?? error.message));

    await window.getByRole('button', { name: 'Open file' }).click();
    const escapedName = path.basename(sourceFile).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await window.getByRole('tab', { name: new RegExp(escapedName, 'i') }).waitFor({
      state: 'visible',
      timeout: 60_000
    });
    await window.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i }).waitFor({
      state: 'visible',
      timeout: 60_000
    });
    await window.waitForTimeout(750);

    const cdp = await window.context().newCDPSession(window);
    await cdp.send('Performance.enable');
    result.samples.push(await collectMetrics(window, cdp, 0));
    const originalLayerCount = result.samples[0].layerCount;

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const layerCount = await exerciseDocument(window, iteration, result.actions);
      if (layerCount !== originalLayerCount) {
        throw new Error(`Layer count drifted before iteration ${iteration}: ${layerCount} vs ${originalLayerCount}.`);
      }
      const sample = await collectMetrics(window, cdp, iteration);
      result.samples.push(sample);
      if (sample.layerCount !== originalLayerCount) {
        throw new Error(`Layer count drifted after iteration ${iteration}: ${sample.layerCount} vs ${originalLayerCount}.`);
      }
      if (sample.runtimeStopped || sample.invalidHookOrder) {
        throw new Error(`Document runtime failed during iteration ${iteration}.`);
      }
    }

    result.growth = growthAssessment(result.samples);
    if (result.pageErrors.length) {
      result.failures.push(`Page errors: ${result.pageErrors.join(' | ')}`);
    }
    if (result.growth.suspicious) {
      result.failures.push(`Suspicious retained growth: ${result.growth.reasons.join('; ')}`);
    }
  } catch (error) {
    result.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    if (window && !window.isClosed()) {
      const safeName = `${String(fileIndex + 1).padStart(2, '0')}-${path.basename(sourceFile)}`
        .replace(/[^a-z0-9._-]+/gi, '-');
      result.screenshot = path.join(screenshotDirectory, `${safeName}.png`);
      await window.screenshot({ path: result.screenshot }).catch((error) => {
        result.failures.push(`Screenshot failed: ${error}`);
      });
    }
    await electronApp?.close().catch((error) => {
      result.failures.push(`Electron close failed: ${error}`);
    });
  }
  result.passed = result.failures.length === 0;
  return result;
};

const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  executablePath,
  iterations,
  skipPaint,
  actions: [...actionSet],
  policy: {
    neverSave: true,
    heapGrowthThresholdBytes: 96 * 1024 * 1024,
    heapGrowthThresholdRatio: 0.5,
    domNodeGrowthThreshold: 64,
    eventListenerGrowthThreshold: 64,
    gpuGrowthThresholdBytes: 128 * 1024 * 1024
  },
  files: []
};

for (let index = 0; index < files.length; index += 1) {
  report.files.push(await runFile(files[index], index));
  await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
}

report.passed = report.files.every(({ passed }) => passed);
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.info(`LightTable desktop stress report: ${outputFile}`);
for (const file of report.files) {
  console.info(`${file.passed ? 'PASS' : 'FAIL'} ${file.sourceFile}`);
  for (const failure of file.failures) console.info(`  ${failure.split('\n')[0]}`);
}
if (!report.passed) process.exitCode = 1;
