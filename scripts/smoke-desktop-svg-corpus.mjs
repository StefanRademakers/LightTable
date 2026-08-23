import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { access, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { captureDesktopTestState, resolveDesktopTestLaunch,
  waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const corpus = path.resolve(argument('corpus', path.join(root, 'tmp', 'svg-corpus')));
const output = path.resolve(argument('output', path.join(root, 'tmp', 'svg-corpus-smoke')));
const fileFilter = argument('file', '').toLowerCase();
const profilePan = argument('profile-pan', 'false') === 'true';
const profileZoom = argument('profile-zoom', 'false') === 'true';
const profileOpen = argument('profile-open', 'false') === 'true';
const profileMutation = argument('profile-mutation', 'false') === 'true';
const entries = (await readdir(corpus, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
  .filter((entry) => !fileFilter || entry.name.toLowerCase().includes(fileFilter))
  .map((entry) => ({ name: entry.name, source: path.join(corpus, entry.name) }))
  .sort((left, right) => left.name.localeCompare(right.name));
assert.ok(entries.length, `No SVG files found in ${corpus}.`);
await mkdir(output, { recursive: true });
const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const results = [];

const pixelEvidence = async (bytes) => {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonTransparent = 0; let translucent = 0; let colored = 0;
  const colors = new Set();
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2]; const a = data[offset + 3];
    if (a) nonTransparent += 1;
    if (a > 0 && a < 255) translucent += 1;
    if (a && (Math.max(r, g, b) - Math.min(r, g, b) > 8)) colored += 1;
    if (colors.size < 65_536 && a) colors.add(`${r},${g},${b},${a}`);
  }
  const pixels = info.width * info.height;
  return {
    width: info.width, height: info.height, pixels,
    nonTransparentPixels: nonTransparent,
    nonTransparentRatio: nonTransparent / pixels,
    translucentPixels: translucent,
    coloredPixels: colored,
    sampledUniqueColors: colors.size
  };
};

const differenceEvidence = async (left, right) => {
  const decoded = await Promise.all([left, right].map((input) =>
    sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const [actual, reference] = decoded;
  if (actual.info.width !== reference.info.width || actual.info.height !== reference.info.height) {
    return { comparable: false, actual: actual.info, reference: reference.info };
  }
  let squared = 0; let absolute = 0; let changedPixels = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(actual.data[offset + channel] - reference.data[offset + channel]);
      squared += delta * delta; absolute += delta;
      if (delta > 16) pixelChanged = true;
    }
    if (pixelChanged) changedPixels += 1;
  }
  const channels = actual.data.length; const pixels = channels / 4;
  return { comparable: true, rmse: Math.sqrt(squared / channels),
    meanAbsoluteError: absolute / channels, changedPixelRatioAt16: changedPixels / pixels };
};

const startCpuProfile = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  return cdp;
};

const stopCpuProfile = async (cdp) => {
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.detach();
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const selfTime = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const nodeId = profile.samples[index];
    if (!nodes.has(nodeId)) continue;
    selfTime.set(nodeId, (selfTime.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  const frameSummary = ({ functionName, url, lineNumber }) => ({
    functionName: functionName || '(anonymous)', url, line: lineNumber + 1
  });
  return [...selfTime.entries()].map(([nodeId, microseconds]) => {
    const node = nodes.get(nodeId);
    const stack = [];
    for (let current = nodeId; current && stack.length < 14; current = parents.get(current)) {
      const ancestor = nodes.get(current);
      if (ancestor) stack.push(frameSummary(ancestor.callFrame));
    }
    return { ...frameSummary(node.callFrame), selfMs: microseconds / 1000, stack };
  }).sort((left, right) => right.selfMs - left.selfMs).slice(0, 30);
};

const panEvidence = async (page, driver, documentId) => {
  const moveCanvas = page.getByRole('button', { name: /Move canvas/i }).first();
  if (!await moveCanvas.count()) return { available: false, reason: 'Move canvas tool unavailable.' };
  await moveCanvas.click();
  const viewport = page.locator('.lighttable-viewport');
  const box = await viewport.boundingBox();
  if (!box) return { available: false, reason: 'Viewport bounds unavailable.' };
  await driver.resetRenderTelemetry(documentId);
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.45 };
  const cdp = profilePan ? await startCpuProfile(page) : null;
  const startedAt = performance.now();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + Math.min(240, box.width * 0.25), start.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForFunction((id) => (
    (window.__lightTableAutomation?.queryRenderTelemetry?.(id)?.submittedFrames ?? 0) > 0
  ), documentId, { timeout: 10_000 });
  const settledMs = Math.round(performance.now() - startedAt);
  const telemetry = await driver.queryRenderTelemetry(documentId);
  const cpuProfile = cdp ? await stopCpuProfile(cdp) : null;
  return { available: true, settledMs, inputSteps: 24, telemetry, cpuProfile };
};

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const zoomEvidence = async (page, driver, documentId) => {
  const viewport = page.locator('.lighttable-viewport');
  const box = await viewport.boundingBox();
  if (!box) return { available: false, reason: 'Viewport bounds unavailable.' };
  await page.keyboard.press('Control+1');
  await page.waitForFunction(() => [...document.querySelectorAll('.lighttable-toolbar__meta')]
    .some((node) => node.textContent?.includes('100%')), undefined, { timeout: 5_000 });
  const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await page.mouse.move(center.x, center.y);
  await driver.resetRenderTelemetry(documentId);
  await page.evaluate(() => {
    const sample = { startedAt: performance.now(), previous: performance.now(), intervals: [], stopped: false };
    const tick = (now) => {
      sample.intervals.push(now - sample.previous);
      sample.previous = now;
      if (!sample.stopped) requestAnimationFrame(tick);
    };
    window.__lightTableZoomFrameSample = sample;
    requestAnimationFrame(tick);
  });
  const cdp = profileZoom ? await startCpuProfile(page) : null;
  const startedAt = performance.now();
  await page.keyboard.down('Control');
  for (let index = 0; index < 24; index += 1) await page.mouse.wheel(0, -48);
  await page.keyboard.up('Control');
  await page.waitForFunction((id) => (
    (window.__lightTableAutomation?.queryRenderTelemetry?.(id)?.submittedFrames ?? 0) > 0
  ), documentId, { timeout: 30_000 });
  await page.waitForTimeout(250);
  const settledMs = Math.round(performance.now() - startedAt);
  const frameIntervals = await page.evaluate(() => {
    const sample = window.__lightTableZoomFrameSample;
    if (!sample) return [];
    sample.stopped = true;
    delete window.__lightTableZoomFrameSample;
    return sample.intervals;
  });
  const telemetry = await driver.queryRenderTelemetry(documentId);
  const cpuProfile = cdp ? await stopCpuProfile(cdp) : null;
  const zoomText = await page.locator('.lighttable-toolbar__meta')
    .filter({ hasText: /ready/i }).first().textContent().catch(() => null);
  await page.keyboard.press('Control+0');
  const meaningfulIntervals = frameIntervals.filter((value) => value > 0 && value < 5_000);
  return {
    available: true,
    settledMs,
    inputSteps: 24,
    finalStatus: zoomText,
    animationFrames: meaningfulIntervals.length,
    frameIntervalMs: {
      median: percentile(meaningfulIntervals, 0.5),
      p95: percentile(meaningfulIntervals, 0.95),
      p99: percentile(meaningfulIntervals, 0.99),
      maximum: Math.max(0, ...meaningfulIntervals),
      over16_7: meaningfulIntervals.filter((value) => value > 16.7).length,
      over33_3: meaningfulIntervals.filter((value) => value > 33.3).length
    },
    telemetry,
    cpuProfile
  };
};

const rendererMemoryEvidence = async (page, driver, documentId) => {
  const document = await driver.queryDocument(documentId);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const metric = (name) => metrics.find((entry) => entry.name === name)?.value ?? null;
  const browserHeap = await page.evaluate(() => {
    const memory = performance.memory;
    return memory ? {
      usedJsHeapBytes: memory.usedJSHeapSize,
      totalJsHeapBytes: memory.totalJSHeapSize,
      jsHeapLimitBytes: memory.jsHeapSizeLimit
    } : null;
  });
  return {
    estimatedGpuBytes: document?.renderer?.estimatedGpuBytes ?? null,
    history: document?.history ? {
      undoDepth: document.history.undoDepth,
      redoDepth: document.history.redoDepth,
      estimatedBytes: document.history.estimatedBytes
    } : null,
    browserHeap,
    cdp: {
      jsHeapUsedBytes: metric('JSHeapUsedSize'),
      jsHeapTotalBytes: metric('JSHeapTotalSize'),
      nodes: metric('Nodes'),
      documents: metric('Documents')
    }
  };
};

const mutationEvidence = async (page, driver, documentId, originalPreviewBytes) => {
  if (!profileMutation) return { available: false, reason: 'Mutation profiling disabled.' };
  const layerProjection = await driver.queryLayers(documentId);
  const layers = Array.isArray(layerProjection) ? layerProjection : layerProjection?.layers;
  const layer = layers?.find((candidate) => candidate.type === 'vector');
  if (!layer) return { available: false, reason: 'No vector layer available.' };
  const vector = await driver.queryVector(documentId, layer.id);
  const element = vector?.elements?.[0];
  if (!element) return { available: false, reason: 'No editable vector element available.' };

  const original = element.transform;
  const before = await rendererMemoryEvidence(page, driver, documentId);
  const samples = [];
  const cdp = await startCpuProfile(page);
  for (let index = 0; index < 6; index += 1) {
    const transform = { ...original, tx: original.tx + (index % 2 === 0 ? 0.5 : 0) };
    await driver.resetRenderTelemetry(documentId);
    const startedAt = performance.now();
    const command = await driver.execute(documentId, 'vector.update', {
      layerId: layer.id,
      elementId: element.id,
      transform
    });
    const rendered = await driver.waitForRenderedDocument(documentId, 120_000);
    samples.push({
      index,
      durationMs: Math.round(performance.now() - startedAt),
      canonicalRevision: rendered.document.canonicalRevision,
      commandStatus: command.status,
      telemetry: rendered.telemetry
    });
  }
  const cpuProfile = await stopCpuProfile(cdp);
  const after = await rendererMemoryEvidence(page, driver, documentId);
  const finalDocument = await driver.queryDocument(documentId);
  const finalPreviewResult = await driver.requestDocumentPreview(
    documentId, finalDocument.canonicalRevision, 1024
  );
  const finalArtifactId = finalPreviewResult?.artifact?.id ?? finalPreviewResult?.id;
  const finalArtifact = finalArtifactId ? await driver.readArtifact(finalArtifactId) : null;
  const restoredPreview = finalArtifact?.bytes?.length
    ? await differenceEvidence(finalArtifact.bytes, originalPreviewBytes)
    : { comparable: false, reason: 'Final mutation preview unavailable.' };
  return {
    available: true,
    layerId: layer.id,
    elementId: element.id,
    iterations: samples.length,
    before,
    after,
    delta: {
      estimatedGpuBytes: after.estimatedGpuBytes === null || before.estimatedGpuBytes === null
        ? null : after.estimatedGpuBytes - before.estimatedGpuBytes,
      jsHeapUsedBytes: after.cdp.jsHeapUsedBytes === null || before.cdp.jsHeapUsedBytes === null
        ? null : after.cdp.jsHeapUsedBytes - before.cdp.jsHeapUsedBytes,
      nodes: after.cdp.nodes === null || before.cdp.nodes === null
        ? null : after.cdp.nodes - before.cdp.nodes
    },
    restoredPreview,
    samples,
    cpuProfile
  };
};

for (const [index, entry] of entries.entries()) {
  await access(entry.source);
  const slug = `${String(index + 1).padStart(2, '0')}-${entry.name.replace(/[^a-z0-9.-]+/giu, '-')}`;
  const profile = await mkdtemp(path.join(output, `profile-${String(index + 1).padStart(2, '0')}-`));
  const pageErrors = []; const consoleErrors = []; let app; let page;
  const startedAt = performance.now();
  const timings = {};
  const measure = async (name, operation) => {
    const phaseStartedAt = performance.now();
    try {
      return await operation();
    } finally {
      timings[name] = Math.round(performance.now() - phaseStartedAt);
    }
  };
  try {
    const referencePath = path.join(output, `${slug}-source-reference.png`);
    const environment = {
      ...process.env,
      LIGHTTABLE_AUTOMATION_USER_DATA: profile,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: entry.source
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    app = await measure('launchApplicationMs', () => electron.launch({
      executablePath: launch.executablePath, args: launch.args,
      cwd: root, env: environment, timeout: 30_000
    }));
    page = await measure('firstWindowMs', () => app.firstWindow({ timeout: 30_000 }));
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const open = await measure('launcherReadyMs', () => waitForDesktopLauncher({
      app, page, outputDirectory: output,
      sourceFile: entry.source, pageErrors, label: slug, timeout: 30_000
    }));
    const openProfile = profileOpen ? await startCpuProfile(page) : null;
    await measure('openIntentMs', () => open.click());
    const driver = await measure('automationAttachMs', () =>
      attachLightTableAutomation(page, `svg-corpus-${index}`, 30_000));
    await measure('workspaceDocumentReadyMs', () => page.waitForFunction(() => {
      const workspace = window.__lightTableAutomation?.queryWorkspace();
      return Boolean(workspace?.activeDocumentId);
    }, undefined, { timeout: 60_000 }));
    const workspace = await driver.queryWorkspace();
    const documentId = workspace.activeDocumentId;
    const rendered = await measure('firstRenderedDocumentMs', () =>
      driver.waitForRenderedDocument(documentId, 120_000));
    const openCpuProfile = openProfile ? await stopCpuProfile(openProfile) : null;
    const previewResult = await measure('previewRequestMs', () => driver.requestDocumentPreview(
      documentId, rendered.document.canonicalRevision, 1024
    ));
    const artifactId = previewResult?.artifact?.id ?? previewResult?.id;
    const artifact = artifactId
      ? await measure('previewArtifactReadMs', () => driver.readArtifact(artifactId))
      : null;
    assert.ok(artifact?.bytes?.length, `${entry.name} produced no preview bytes.`);
    const previewPath = path.join(output, `${slug}-preview.png`);
    const screenshotPath = path.join(output, `${slug}-window.png`);
    await measure('evidenceWriteMs', () => Promise.all([
      writeFile(previewPath, artifact.bytes),
      page.screenshot({ path: screenshotPath })
    ]));
    const pixels = await measure('pixelEvidenceMs', () => pixelEvidence(artifact.bytes));
    const referenceBytes = await measure('referenceRenderMs', () => sharp(entry.source).resize({
      width: pixels.width, height: pixels.height, fit: 'fill'
    }).png().toBuffer());
    await measure('referenceWriteMs', () => writeFile(referencePath, referenceBytes));
    const difference = await measure('differenceEvidenceMs', () =>
      differenceEvidence(artifact.bytes, referenceBytes));
    const pan = await measure('panEvidenceMs', () => panEvidence(page, driver, documentId));
    const zoom = await measure('zoomEvidenceMs', () => zoomEvidence(page, driver, documentId));
    const mutation = await measure('mutationEvidenceMs', () => mutationEvidence(
      page, driver, documentId, artifact.bytes
    ));
    assert.ok(pixels.nonTransparentPixels > 0, `${entry.name} rendered a fully transparent preview.`);
    const layers = await driver.queryLayers(documentId);
    results.push({ file: entry.name, status: 'pass', durationMs: Math.round(performance.now() - startedAt),
      timings,
      openCpuProfile,
      document: { id: documentId, canvas: rendered.document.canvas,
        layerCount: rendered.document.layerCount, revision: rendered.document.canonicalRevision },
      layers: Array.isArray(layers) ? layers : layers?.layers ?? null,
      renderer: { submittedFrames: rendered.telemetry.submittedFrames,
        compositeExecutions: rendered.telemetry.stages?.['document-composite']?.executions ?? 0,
        vectorBackend: rendered.telemetry.vectorBackend ?? null },
      pixels, difference, pan, zoom, mutation,
      pageErrors, consoleErrors, previewPath, referencePath, screenshotPath });
  } catch (error) {
    const diagnostic = app && page ? await captureDesktopTestState({ app, page,
      outputDirectory: output, sourceFile: entry.source, pageErrors, label: `${slug}-failure`,
      details: { consoleErrors } }).catch(() => null) : null;
    results.push({ file: entry.name, status: 'fail', durationMs: Math.round(performance.now() - startedAt),
      timings,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      diagnostic, pageErrors, consoleErrors });
  } finally {
    await app?.close().catch(() => {});
  }
}

const report = { generatedAt: new Date().toISOString(), mode: launch.mode,
  executablePath: launch.executablePath, corpus, results };
const reportPath = path.join(output, 'report.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failed = results.filter(({ status }) => status === 'fail');
const mutationSummary = (mutation) => !mutation?.available ? mutation : ({
  available: true,
  iterations: mutation.iterations,
  delta: mutation.delta,
  restoredPreview: mutation.restoredPreview,
  samples: mutation.samples.map((sample) => ({
    durationMs: sample.durationMs,
    documentComposite: sample.telemetry.stages?.['document-composite']
  })),
  cpuTop: mutation.cpuProfile?.slice(0, 10).map(({ functionName, selfMs, url, line }) => ({
    functionName, selfMs, url, line
  })) ?? null
});
console.log(JSON.stringify({ reportPath, files: results.length, failed: failed.length,
  results: results.map(({ file, status, durationMs, timings, pixels, difference, pan, zoom, mutation }) => (
    { file, status, durationMs, timings, pixels, difference, pan, zoom,
      mutation: mutationSummary(mutation) }
  )) }, null, 2));
if (failed.length) process.exitCode = 1;
