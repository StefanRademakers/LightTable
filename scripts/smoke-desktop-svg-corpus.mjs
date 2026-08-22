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

const panEvidence = async (page, driver, documentId) => {
  const moveCanvas = page.getByRole('button', { name: /Move canvas/i }).first();
  if (!await moveCanvas.count()) return { available: false, reason: 'Move canvas tool unavailable.' };
  await moveCanvas.click();
  const viewport = page.locator('.lighttable-viewport');
  const box = await viewport.boundingBox();
  if (!box) return { available: false, reason: 'Viewport bounds unavailable.' };
  await driver.resetRenderTelemetry(documentId);
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.45 };
  const cdp = profilePan ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
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
  let cpuProfile = null;
  if (cdp) {
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
    cpuProfile = [...selfTime.entries()].map(([nodeId, microseconds]) => {
      const node = nodes.get(nodeId);
      const stack = [];
      for (let current = nodeId; current && stack.length < 14; current = parents.get(current)) {
        const ancestor = nodes.get(current);
        if (ancestor) stack.push(frameSummary(ancestor.callFrame));
      }
      return { ...frameSummary(node.callFrame), selfMs: microseconds / 1000, stack };
    }).sort((left, right) => right.selfMs - left.selfMs).slice(0, 20);
  }
  return { available: true, settledMs, inputSteps: 24, telemetry, cpuProfile };
};

for (const [index, entry] of entries.entries()) {
  await access(entry.source);
  const slug = `${String(index + 1).padStart(2, '0')}-${entry.name.replace(/[^a-z0-9.-]+/giu, '-')}`;
  const profile = await mkdtemp(path.join(output, `profile-${String(index + 1).padStart(2, '0')}-`));
  const pageErrors = []; const consoleErrors = []; let app; let page;
  const startedAt = performance.now();
  try {
    const referencePath = path.join(output, `${slug}-source-reference.png`);
    const environment = {
      ...process.env,
      LIGHTTABLE_AUTOMATION_USER_DATA: profile,
      LIGHTTABLE_AUTOMATION_OPEN_FILE: entry.source
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: launch.executablePath, args: launch.args,
      cwd: root, env: environment, timeout: 30_000 });
    page = await app.firstWindow({ timeout: 30_000 });
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const open = await waitForDesktopLauncher({ app, page, outputDirectory: output,
      sourceFile: entry.source, pageErrors, label: slug, timeout: 30_000 });
    await open.click();
    const driver = await attachLightTableAutomation(page, `svg-corpus-${index}`, 30_000);
    await page.waitForFunction(() => {
      const workspace = window.__lightTableAutomation?.queryWorkspace();
      return Boolean(workspace?.activeDocumentId);
    }, undefined, { timeout: 60_000 });
    const workspace = await driver.queryWorkspace();
    const documentId = workspace.activeDocumentId;
    const rendered = await driver.waitForRenderedDocument(documentId, 120_000);
    const previewResult = await driver.requestDocumentPreview(
      documentId, rendered.document.canonicalRevision, 1024
    );
    const artifactId = previewResult?.artifact?.id ?? previewResult?.id;
    const artifact = artifactId ? await driver.readArtifact(artifactId) : null;
    assert.ok(artifact?.bytes?.length, `${entry.name} produced no preview bytes.`);
    const previewPath = path.join(output, `${slug}-preview.png`);
    const screenshotPath = path.join(output, `${slug}-window.png`);
    await Promise.all([
      writeFile(previewPath, artifact.bytes),
      page.screenshot({ path: screenshotPath })
    ]);
    const pixels = await pixelEvidence(artifact.bytes);
    const referenceBytes = await sharp(entry.source).resize({ width: pixels.width,
      height: pixels.height, fit: 'fill' }).png().toBuffer();
    await writeFile(referencePath, referenceBytes);
    const difference = await differenceEvidence(artifact.bytes, referenceBytes);
    const pan = await panEvidence(page, driver, documentId);
    assert.ok(pixels.nonTransparentPixels > 0, `${entry.name} rendered a fully transparent preview.`);
    results.push({ file: entry.name, status: 'pass', durationMs: Math.round(performance.now() - startedAt),
      document: { id: documentId, canvas: rendered.document.canvas,
        layerCount: rendered.document.layerCount, revision: rendered.document.canonicalRevision },
      renderer: { submittedFrames: rendered.telemetry.submittedFrames,
        compositeExecutions: rendered.telemetry.stages?.['document-composite']?.executions ?? 0 },
      pixels, difference, pan, pageErrors, consoleErrors, previewPath, referencePath, screenshotPath });
  } catch (error) {
    const diagnostic = app && page ? await captureDesktopTestState({ app, page,
      outputDirectory: output, sourceFile: entry.source, pageErrors, label: `${slug}-failure`,
      details: { consoleErrors } }).catch(() => null) : null;
    results.push({ file: entry.name, status: 'fail', durationMs: Math.round(performance.now() - startedAt),
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
console.log(JSON.stringify({ reportPath, files: results.length, failed: failed.length,
  results: results.map(({ file, status, durationMs, pixels, difference, pan }) => (
    { file, status, durationMs, pixels, difference, pan }
  )) }, null, 2));
if (failed.length) process.exitCode = 1;
