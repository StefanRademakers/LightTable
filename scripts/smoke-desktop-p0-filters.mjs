import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const positiveDimension = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32_768) {
    throw new Error(`${name} must be an integer between 1 and 32768.`);
  }
  return value;
};
const documentWidth = positiveDimension('LIGHTTABLE_P0_FILTER_WIDTH', 1920);
const documentHeight = positiveDimension('LIGHTTABLE_P0_FILTER_HEIGHT', 1080);
if (documentWidth * documentHeight > 268_435_456) {
  throw new Error('P0 filter smoke document exceeds the application pixel limit.');
}
const output = path.join(root, 'tmp', `p0-filter-smoke-${documentWidth}x${documentHeight}`);
const userData = path.join(output, `user-data-${process.pid}`);
await mkdir(userData, { recursive: true });

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const errors = { page: [], console: [] };
const report = {
  schema: 2, generatedAt: new Date().toISOString(), launchMode: launch.mode,
  documentSize: { width: documentWidth, height: documentHeight },
  baselineCanvasSha256: null, baselineEstimatedGpuBytes: null,
  warmPoolEstimatedGpuBytes: null, filters: [], errors
};
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: environment,
  timeout: 30_000
});

const filters = [
  ['gaussian-blur', { radius: 12 }],
  ['motion-blur', { angle: 32, distance: 24 }],
  ['surface-blur', { radius: 18, threshold: 24 }],
  ['displace', null],
  ['median', { radius: 12 }],
  ['reduce-noise', { strength: 7, preserveDetails: 55, reduceColorNoise: 60, sharpenDetails: 15 }],
  ['smart-sharpen', { amount: 140, radius: 2, reduceNoise: 25, remove: 'lens', angle: 0 }],
  ['unsharp-mask', { amount: 125, radius: 2, threshold: 3 }],
  ['high-pass', { radius: 8 }],
  ['maximum', { radius: 8, shape: 'round' }],
  ['minimum', { radius: 8, shape: 'square' }],
  ['offset', { horizontal: 37, vertical: -21, edgeMode: 'wrap' }]
];

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => errors.page.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  await page.setViewportSize({ width: 1000, height: 760 });
  await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: 'generated-p0-filter-fixture',
    pageErrors: errors.page, label: 'p0-filter'
  });
  await page.getByRole('button', { name: 'New document' }).click();
  const newDocument = page.locator('form.lighttable-new-document-dialog');
  await newDocument.getByLabel('Width', { exact: true }).fill(String(documentWidth));
  await newDocument.getByLabel('Height', { exact: true }).fill(String(documentHeight));
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'p0-filter-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('P0 filter smoke has no active document.');
  const layers = await driver.queryLayers(documentId) ?? [];
  const raster = layers.find(({ type }) => type === 'raster');
  if (!raster) throw new Error('P0 filter smoke fixture has no raster layer.');

  await driver.execute(documentId, 'raster.applyGradient', {
    layerId: raster.id,
    channel: 'pixels',
    opacity: 1,
    blendMode: 'normal',
    paint: {
      kind: 'gradient', shape: 'linear', coordinateSpace: 'document',
      asset: {
        id: 'p0-filter-spectrum', name: 'P0 filter spectrum', type: 'solid',
        smoothness: 1, roughness: 0, seed: 0,
        colorStops: [
          { id: 'dark', position: 0, midpoint: 0.5, color: { r: 0.01, g: 0.03, b: 0.12, a: 1 } },
          { id: 'warm', position: 0.46, midpoint: 0.35, color: { r: 1, g: 0.16, b: 0.03, a: 1 } },
          { id: 'cool', position: 1, midpoint: 0.5, color: { r: 0.03, g: 0.8, b: 1, a: 1 } }
        ],
        opacityStops: [
          { id: 'opaque-start', position: 0, midpoint: 0.5, opacity: 1 },
          { id: 'opaque-end', position: 1, midpoint: 0.5, opacity: 1 }
        ]
      },
      transform: { a: 512, b: 0, c: 0, d: 512, tx: 0, ty: 0 },
      reverse: false, dither: true, interpolation: 'perceptual'
    }
  });

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = page.locator('.lighttable-viewport__canvas');
  const baselineImage = await canvas.screenshot({ path: path.join(output, 'baseline.png') });
  const baselineHash = createHash('sha256').update(baselineImage).digest('hex');
  report.baselineCanvasSha256 = baselineHash;
  report.baselineEstimatedGpuBytes = (await driver.queryDocument(documentId))?.renderer?.estimatedGpuBytes ?? null;

  for (const [filterIndex, [kind, baseSettings]] of filters.entries()) {
    const settings = kind === 'displace' ? {
      horizontalScale: 18, verticalScale: -12, mapAssetId: raster.id,
      edgeMode: 'clamp', interpolation: 'bicubic'
    } : baseSettings;
    process.stdout.write(`Validating ${kind}: ${JSON.stringify(settings)}\n`);
    const startedAt = performance.now();
    const created = await driver.execute(documentId, 'adjustment.create', {
      kind, placement: 'adjustment-layer', aboveLayerId: raster.id, settings
    });
    const filterLayerId = created.value?.layerId;
    if (!filterLayerId) throw new Error(`${kind} did not return its adjustment-layer ID.`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const renderReadyMs = performance.now() - startedAt;
    const image = await canvas.screenshot({ path: path.join(output, `${kind}.png`) });
    const screenshotSha256 = createHash('sha256').update(image).digest('hex');
    if (screenshotSha256 === baselineHash) {
      throw new Error(`${kind} rendered the unchanged baseline canvas despite non-neutral settings.`);
    }
    const documentState = await driver.queryDocument(documentId);
    report.filters.push({
      kind,
      renderReadyMs,
      screenshotSha256,
      estimatedGpuBytes: documentState?.renderer?.estimatedGpuBytes ?? null
    });
    if (kind === 'reduce-noise') {
      report.warmPoolEstimatedGpuBytes = documentState?.renderer?.estimatedGpuBytes ?? null;
    } else if (filterIndex > filters.findIndex(([candidate]) => candidate === 'reduce-noise')
      && report.warmPoolEstimatedGpuBytes !== documentState?.renderer?.estimatedGpuBytes) {
      throw new Error(`${kind} grew GPU memory after the shared three-target pool was warm.`);
    }
    if (errors.page.length || errors.console.length) {
      throw new Error(`${kind} produced renderer errors: ${JSON.stringify(errors)}`);
    }
    await driver.execute(documentId, 'layer.delete', { layerIds: [filterLayerId] });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const restored = await canvas.screenshot();
    const restoredHash = createHash('sha256').update(restored).digest('hex');
    if (restoredHash !== baselineHash) {
      throw new Error(`${kind} left stale pixels behind after deleting its filter layer.`);
    }
  }

  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`P0 filter smoke passed: ${path.join(output, 'report.json')}\n`);
} finally {
  await app.close();
}
