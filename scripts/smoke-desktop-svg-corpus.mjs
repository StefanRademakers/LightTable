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
const entries = (await readdir(corpus, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
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
    assert.ok(pixels.nonTransparentPixels > 0, `${entry.name} rendered a fully transparent preview.`);
    results.push({ file: entry.name, status: 'pass', durationMs: Math.round(performance.now() - startedAt),
      document: { id: documentId, canvas: rendered.document.canvas,
        layerCount: rendered.document.layerCount, revision: rendered.document.canonicalRevision },
      renderer: { submittedFrames: rendered.telemetry.submittedFrames,
        compositeExecutions: rendered.telemetry.stages?.['document-composite']?.executions ?? 0 },
      pixels, difference, pageErrors, consoleErrors, previewPath, referencePath, screenshotPath });
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
  results: results.map(({ file, status, durationMs, pixels, difference }) => (
    { file, status, durationMs, pixels, difference }
  )) }, null, 2));
if (failed.length) process.exitCode = 1;
