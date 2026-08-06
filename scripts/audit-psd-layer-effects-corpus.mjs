import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const argument = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const workspace = path.resolve(import.meta.dirname, '..');
const corpusRoot = path.resolve(argument('root',
  'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip'));
const manifestPath = path.join(corpusRoot, 'manifest.json');
const reportPath = path.resolve(argument('report', path.join(corpusRoot, 'lighttable-report.json')));
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
const requestedFamily = argument('family');
const requestedIds = new Set(argument('ids').split(',').map((value) => value.trim()).filter(Boolean));
const limit = Number.parseInt(argument('limit', '0'), 10);
const strict = process.argv.includes('--strict');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let cases = manifest.cases.filter((entry) => (!requestedFamily || entry.family === requestedFamily)
  && (!requestedIds.size || requestedIds.has(entry.id)));
if (limit > 0) cases = cases.slice(0, limit);
await Promise.all([access(executable), ...cases.flatMap(({ canonical, reference }) =>
  [access(canonical), access(reference)])]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const outputDirectory = path.join(corpusRoot, 'lighttable');
const differenceDirectory = path.join(corpusRoot, 'difference');
await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(differenceDirectory, { recursive: true }),
  mkdir(path.dirname(reportPath), { recursive: true })
]);

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'number') return Math.round(value * 10_000) / 10_000;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'id' && key !== 'layerId' && key !== 'revision')
    .map(([key, nested]) => [key, stable(nested)]));
};
const compare = async (referencePath, candidatePath, differencePath) => {
  const [reference, candidate] = await Promise.all([
    sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (reference.info.width !== candidate.info.width || reference.info.height !== candidate.info.height) {
    throw new Error(`Image dimensions differ: ${reference.info.width}x${reference.info.height} vs ${candidate.info.width}x${candidate.info.height}`);
  }
  const pixels = reference.info.width * reference.info.height;
  const difference = Buffer.alloc(reference.data.length);
  let changed = 0;
  let significant = 0;
  let maximum = 0;
  let sum = 0;
  let squared = 0;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(reference.data[offset + channel] - candidate.data[offset + channel]);
      pixelDelta = Math.max(pixelDelta, delta);
      difference[offset + channel] = channel === 3 ? 255 : Math.min(255, delta * 4);
      if (channel < 3) squared += delta * delta;
    }
    if (pixelDelta) { changed += 1; sum += pixelDelta; maximum = Math.max(maximum, pixelDelta); }
    if (pixelDelta > 8) significant += 1;
  }
  await sharp(difference, { raw: { width: reference.info.width, height: reference.info.height, channels: 4 } })
    .png().toFile(differencePath);
  return {
    changedPercent: changed / pixels * 100,
    significantPercent: significant / pixels * 100,
    meanChangedDelta: changed ? sum / changed : 0,
    maximumDelta: maximum,
    rgbRmse: Math.sqrt(squared / (pixels * 3))
  };
};

const results = [];
for (const [index, entry] of cases.entries()) {
  const caseStartedAt = performance.now();
  const userData = path.join(corpusRoot, 'runtime', `${process.pid}-${entry.id}`);
  await mkdir(userData, { recursive: true });
  const importedPath = path.join(outputDirectory, `${entry.id}-import.png`);
  const roundtripPath = path.join(outputDirectory, `${entry.id}-roundtrip.png`);
  const app = await electron.launch({
    executablePath: executable,
    args: [path.join(workspace, 'apps', 'desktop')], cwd: workspace,
    env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: entry.canonical,
      LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000
  });
  const result = { id: entry.id, family: entry.family, parameters: entry.parameters,
    source: entry.canonical, reference: entry.reference };
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 20, y: 20, width: 1500, height: 1100 });
    });
    const page = await app.firstWindow({ timeout: 30_000 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    const openFileButton = page.getByRole('button', { name: 'Open file' });
    // A 40-case cold-launch corpus can briefly contend with Windows process
    // teardown and shader-cache I/O. Keep the product readiness gate strict,
    // but do not inherit Playwright's shorter implicit action timeout here.
    await openFileButton.waitFor({ state: 'visible', timeout: 60_000 });
    await openFileButton.click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    result.openReadyMs = performance.now() - caseStartedAt;
    const driver = await attachLightTableAutomation(page, `fx-${entry.id}`);
    await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
    const state = await driver.queryWorkspace();
    const documentId = state?.activeDocumentId;
    if (!documentId) throw new Error('No active document.');
    const layers = await driver.queryLayers(documentId) ?? [];
    const owner = layers.find((layer) => layer.name === `FX ${entry.id}`);
    if (!owner) throw new Error('Effect owner layer was not imported.');
    const beforeEffects = stable(await driver.queryLayerEffects(documentId, owner.id));
    if (!beforeEffects?.effects?.length) throw new Error('Editable layer effects were not imported.');
    await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 100 });
    await page.waitForTimeout(350);
    const importCaptureStartedAt = performance.now();
    const viewport = await page.locator('.lighttable-viewport').boundingBox();
    const meta = await page.locator('.lighttable-toolbar__meta').textContent() ?? '';
    const size = meta.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!viewport || !size) throw new Error(`Cannot resolve canvas bounds: ${meta}`);
    const width = Number(size[1]); const height = Number(size[2]);
    const clip = { x: Math.round(viewport.x + (viewport.width - width) / 2),
      y: Math.round(viewport.y + (viewport.height - height) / 2), width, height };
    await page.screenshot({ path: importedPath, clip });
    result.importMetrics = await compare(entry.reference, importedPath,
      path.join(differenceDirectory, `${entry.id}-import.png`));
    result.importCaptureAndCompareMs = performance.now() - importCaptureStartedAt;

    const roundtripStartedAt = performance.now();
    const accepted = await driver.execute(documentId, 'file.exportPsd', {}, { requireCompleted: false });
    if (accepted.status !== 'accepted') throw new Error(`PSD export rejected: ${JSON.stringify(accepted)}`);
    const task = await driver.waitForTask(documentId, accepted.taskId, 90_000);
    const opened = await driver.execute(documentId, 'file.openArtifact', { artifactId: task.artifact?.id });
    const roundtripId = opened.value?.documentId;
    if (!roundtripId) throw new Error('Exported PSD did not reopen.');
    await page.waitForFunction((id) => {
      const document = window.__lightTableAutomation?.queryDocument(id);
      return document?.lifecycle === 'ready' && document.renderer.status === 'ready'
        && document.tasks.activeCount === 0;
    }, roundtripId, { timeout: 60_000 });
    const afterLayers = await driver.queryLayers(roundtripId) ?? [];
    const afterOwner = afterLayers.find((layer) => layer.name === `FX ${entry.id}`);
    if (!afterOwner) throw new Error('Effect owner layer disappeared after roundtrip.');
    const afterEffects = stable(await driver.queryLayerEffects(roundtripId, afterOwner.id));
    result.semanticParity = JSON.stringify(beforeEffects) === JSON.stringify(afterEffects);
    result.beforeEffects = beforeEffects;
    result.afterEffects = afterEffects;
    await driver.execute(roundtripId, 'view.setZoom', { mode: 'custom', percent: 100 });
    await page.waitForTimeout(350);
    const roundtripViewport = await page.locator('.lighttable-viewport').last().boundingBox();
    const roundtripClip = { x: Math.round(roundtripViewport.x + (roundtripViewport.width - width) / 2),
      y: Math.round(roundtripViewport.y + (roundtripViewport.height - height) / 2), width, height };
    await page.screenshot({ path: roundtripPath, clip: roundtripClip });
    result.roundtripMetrics = await compare(entry.reference, roundtripPath,
      path.join(differenceDirectory, `${entry.id}-roundtrip.png`));
    result.roundtripSelfMetrics = await compare(importedPath, roundtripPath,
      path.join(differenceDirectory, `${entry.id}-self.png`));
    result.exportReopenCaptureAndCompareMs = performance.now() - roundtripStartedAt;
    result.pageErrors = pageErrors;
    result.status = pageErrors.length || !result.semanticParity ? 'failed' : 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    await app.close().catch(() => {});
  }
  result.wallMs = performance.now() - caseStartedAt;
  results.push(result);
  process.stdout.write(`[${index + 1}/${cases.length}] ${entry.id}: ${result.status}`
    + `${result.importMetrics ? `, RMSE ${result.importMetrics.rgbRmse.toFixed(2)}` : ''}\n`);
  await writeFile(reportPath, `${JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(),
    corpusRoot, strict, results }, null, 2)}\n`);
}

const failed = results.filter(({ status }) => status !== 'passed');
// Browser/Electron capture and Photoshop color management establish a small
// non-zero floor even when geometry matches. RMSE > 8 is queued for visual
// review; > 20 is a structural fidelity failure for this controlled corpus.
const fidelityReviews = results.filter(({ importMetrics }) => importMetrics?.rgbRmse > 8);
const fidelityFailures = results.filter(({ importMetrics }) => importMetrics?.rgbRmse > 20);
const summary = { total: results.length, passed: results.length - failed.length,
  failed: failed.length, fidelityReviews: fidelityReviews.length,
  fidelityFailures: fidelityFailures.length,
  reportPath };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length || (strict && fidelityFailures.length)) process.exitCode = 1;
