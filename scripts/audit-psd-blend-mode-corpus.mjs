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
const root = path.resolve(argument('root', 'D:\\Mediavibe\\LightTableTests\\BlendModes'));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const requestedIds = new Set(argument('ids').split(',').map((value) => value.trim()).filter(Boolean));
const cases = manifest.cases.filter(({ id }) => !requestedIds.size || requestedIds.has(id));
const reportPath = path.resolve(argument('report', path.join(root, 'report.json')));
const numericLimit = (name) => {
  const value = argument(name);
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative number.`);
  return parsed;
};
const thresholds = {
  rgbRmse: numericLimit('max-rmse'),
  maximumDelta: numericLimit('max-delta'),
  significantPercent: numericLimit('max-significant-percent')
};
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
await Promise.all([access(executable), ...cases.flatMap(({ canonical, reference }) =>
  [access(canonical), access(reference)])]);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await mkdir(path.join(root, 'runtime'), { recursive: true });

const regions = [
  { id: 'hue-to-white', left: 0, top: 0, width: 400, height: 50 },
  { id: 'hue-to-black', left: 0, top: 50, width: 400, height: 50 },
  { id: 'channel-ramps', left: 0, top: 100, width: 400, height: 75 },
  { id: 'alpha-ramp', left: 0, top: 175, width: 400, height: 25 },
  { id: 'swatches-128', left: 0, top: 200, width: 400, height: 200 }
];
const metrics = (reference, candidate, width, height) => {
  let squared = 0; let maximum = 0; let significant = 0; let maximumOffset = 0;
  for (let offset = 0; offset < reference.length; offset += 4) {
    let pixelMaximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(reference[offset + channel] - candidate[offset + channel]);
      squared += delta * delta;
      if (delta > maximum) { maximum = delta; maximumOffset = offset; }
      pixelMaximum = Math.max(pixelMaximum, delta);
    }
    if (pixelMaximum > 8) significant += 1;
  }
  const pixelIndex = maximumOffset / 4;
  return { rgbRmse: Math.sqrt(squared / (width * height * 3)), maximumDelta: maximum,
    significantPercent: significant / (width * height) * 100,
    maximumSample: {
      x: pixelIndex % width, y: Math.floor(pixelIndex / width),
      reference: [...reference.subarray(maximumOffset, maximumOffset + 4)],
      candidate: [...candidate.subarray(maximumOffset, maximumOffset + 4)]
    } };
};
const compare = async (referencePath, candidatePath, differencePath, rawDifferencePath) => {
  const [reference, candidate] = await Promise.all([
    sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(candidatePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (reference.info.width !== 400 || reference.info.height !== 400
    || candidate.info.width !== 400 || candidate.info.height !== 400) {
    throw new Error(`Blend comparison must be 400x400: ${reference.info.width}x${reference.info.height}`);
  }
  const difference = Buffer.alloc(reference.data.length);
  const rawDifference = Buffer.alloc(reference.data.length);
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(reference.data[offset + channel] - candidate.data[offset + channel]);
      rawDifference[offset + channel] = delta;
      difference[offset + channel] = Math.min(255, delta * 4);
    }
    difference[offset + 3] = 255; rawDifference[offset + 3] = 255;
  }
  await mkdir(path.dirname(rawDifferencePath), { recursive: true });
  await sharp(difference, { raw: { width: 400, height: 400, channels: 4 } }).png().toFile(differencePath);
  await sharp(rawDifference, { raw: { width: 400, height: 400, channels: 4 } })
    .png().toFile(rawDifferencePath);
  const regionMetrics = {};
  for (const region of regions) {
    const [referenceRegion, candidateRegion] = await Promise.all([
      sharp(referencePath).extract(region).ensureAlpha().raw().toBuffer(),
      sharp(candidatePath).extract(region).ensureAlpha().raw().toBuffer()
    ]);
    regionMetrics[region.id] = metrics(referenceRegion, candidateRegion, region.width, region.height);
  }
  return { ...metrics(reference.data, candidate.data, 400, 400), regions: regionMetrics };
};

const results = [];
for (const [index, entry] of cases.entries()) {
  const startedAt = performance.now();
  const result = { id: entry.id, mode: entry.mode, opacity: entry.opacity, fillOpacity: entry.fillOpacity };
  const userData = path.join(root, 'runtime', `${process.pid}-${entry.id}`);
  await mkdir(userData, { recursive: true });
  let app;
  try {
    app = await electron.launch({ executablePath: executable,
      args: [path.join(workspace, 'apps', 'desktop')], cwd: workspace,
      env: { ...environment, LIGHTTABLE_AUTOMATION_OPEN_FILE: entry.canonical,
        LIGHTTABLE_AUTOMATION_USER_DATA: userData }, timeout: 30_000 });
    await app.evaluate(({ BrowserWindow }) => {
      // An even content viewport keeps the centered 400px document on whole
      // device pixels. A half-pixel screenshot crop would otherwise look like
      // a blend error along every hard chart boundary.
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 20, y: 20, width: 1400, height: 1001 });
    });
    const page = await app.firstWindow({ timeout: 30_000 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
    await page.getByRole('button', { name: 'Open file' }).click();
    await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    const driver = await attachLightTableAutomation(page, `blend-${entry.id}`);
    const state = await driver.queryWorkspace();
    const documentId = state?.activeDocumentId;
    if (!documentId) throw new Error('No active document.');
    const layers = await driver.queryLayers(documentId) ?? [];
    const blendLayer = layers.find((layer) => layer.name === (entry.layerName ?? `Blend ${entry.id}`));
    if (!blendLayer) throw new Error('Blend test layer was not imported.');
    result.imported = { blendMode: blendLayer.blendMode, opacity: blendLayer.opacity,
      fillOpacity: blendLayer.fillOpacity };
    result.semanticParity = blendLayer.blendMode === entry.mode
      && Math.abs(blendLayer.opacity - entry.opacity) <= 1 / 255 + 0.000001
      && Math.abs(blendLayer.fillOpacity - entry.fillOpacity) <= 1 / 255 + 0.000001;
    await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 100 });
    await page.addStyleTag({ content: '.dv-floating-overlay-host { display: none !important; }' });
    await page.waitForTimeout(350);
    const viewport = await page.locator('.lighttable-viewport').boundingBox();
    if (!viewport) throw new Error('Cannot resolve LightTable viewport.');
    await page.screenshot({ path: entry.lightTable, clip: {
      x: Math.round(viewport.x + (viewport.width - 400) / 2),
      y: Math.round(viewport.y + (viewport.height - 400) / 2), width: 400, height: 400
    } });
    result.rawDifference = path.join(root, 'difference-raw', path.basename(entry.difference));
    result.metrics = await compare(entry.reference, entry.lightTable, entry.difference, result.rawDifference);
    const [left, right] = await Promise.all([
      sharp(entry.lightTable).removeAlpha().png().toBuffer(),
      sharp(entry.reference).flatten({ background: '#d9dde4' }).removeAlpha().png().toBuffer()
    ]);
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#d9dde4' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 400, top: 0 }])
      .png().toFile(entry.compare);
    result.pageErrors = pageErrors;
    result.visualParity = result.metrics.rgbRmse <= thresholds.rgbRmse
      && result.metrics.maximumDelta <= thresholds.maximumDelta
      && result.metrics.significantPercent <= thresholds.significantPercent;
    result.status = pageErrors.length || !result.semanticParity || !result.visualParity ? 'failed' : 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally { await app?.close().catch(() => {}); }
  result.wallMs = performance.now() - startedAt; results.push(result);
  process.stdout.write(`[${index + 1}/${cases.length}] ${entry.id}: ${result.status}`
    + `${result.metrics ? ` RMSE ${result.metrics.rgbRmse.toFixed(2)}` : ''}\n`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ schema: 2,
    generatedAt: new Date().toISOString(), thresholds, regions, results }, null, 2)}\n`);
}
const failed = results.filter(({ status }) => status !== 'passed');
const ranked = results.filter(({ metrics: value }) => value).sort((left, right) =>
  right.metrics.rgbRmse - left.metrics.rgbRmse);
const rankingPath = path.join(path.dirname(reportPath), 'ranking.json');
await writeFile(rankingPath, `${JSON.stringify(ranked.map(({ id, mode, opacity,
  fillOpacity, metrics: value }) => ({ id, mode, opacity, fillOpacity, ...value })), null, 2)}\n`);
process.stdout.write(JSON.stringify({ total: results.length, failed: failed.length,
  worst: ranked.slice(0, 8).map(({ id, metrics: value }) => ({ id, rmse: value.rgbRmse })) }, null, 2) + '\n');
if (failed.length) process.exitCode = 1;
