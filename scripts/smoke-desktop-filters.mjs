import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
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
const documentWidth = positiveDimension('LIGHTTABLE_FILTER_WIDTH', 1280);
const documentHeight = positiveDimension('LIGHTTABLE_FILTER_HEIGHT', 720);
const arguments_ = process.argv.slice(2);
const sourceArgument = arguments_.find((argument) => !argument.startsWith('--'));
const filterArgument = arguments_.find((argument) => argument.startsWith('--filters='));
const sourceFile = sourceArgument ? path.resolve(sourceArgument) : null;
if (documentWidth * documentHeight > 268_435_456) {
  throw new Error('Filter smoke document exceeds the application pixel limit.');
}
const fixtureName = sourceFile ? path.parse(sourceFile).name : `${documentWidth}x${documentHeight}`;
const output = path.join(root, 'tmp', `filter-smoke-${fixtureName}`);
const userData = path.join(output, `user-data-${process.pid}`);
if (sourceFile) await access(sourceFile);
await mkdir(userData, { recursive: true });

const launch = await resolveDesktopTestLaunch(root, { requirePackaged: true });
const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  ...(sourceFile ? { LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile } : {})
};
delete environment.ELECTRON_RUN_AS_NODE;
const errors = { page: [], console: [] };
const report = {
  schema: 4, generatedAt: new Date().toISOString(), launchMode: launch.mode,
  sourceFile,
  documentSize: sourceFile ? null : { width: documentWidth, height: documentHeight },
  gpuAdapter: null,
  baselineCanvasSha256: null, baselineExportSha256: null, baselineEstimatedGpuBytes: null,
  firstPassPeakEstimatedGpuBytes: null, finalEstimatedGpuBytes: null,
  filters: [], cleanupPass: [], errors
};
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: environment,
  timeout: 30_000
});

const allFilters = [
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
  ['offset', { horizontal: 37, vertical: -21, edgeMode: 'wrap' }],
  ['box-blur'],
  ['radial-blur'],
  ['field-blur'],
  ['iris-blur'],
  ['tilt-shift'],
  ['wave'],
  ['ripple'],
  ['twirl'],
  ['spherize'],
  ['polar-coordinates'],
  ['dust-scratches'],
  ['despeckle'],
  ['mosaic'],
  ['color-halftone'],
  ['clouds'],
  ['lens-flare'],
  ['find-edges'],
  ['emboss'],
  ['shape-blur'],
  ['smart-blur'],
  ['path-blur'],
  ['spin-blur'],
  ['pinch'],
  ['shear'],
  ['glass'],
  ['crystallize'],
  ['mezzotint'],
  ['pointillize'],
  ['difference-clouds'],
  ['fibers'],
  ['oil-paint'],
  ['glowing-edges'],
  ['diffuse'],
  ['solarize'],
  ['custom', { kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], scale: 1, offset: 0 }],
  ['cutout'],
  ['plastic-wrap'],
  ['poster-edges'],
  ['watercolor'],
  ['photocopy'],
  ['halftone-pattern'],
  ['stamp'],
  ['torn-edges'],
  ['texturizer']
];
const requestedKinds = new Set((filterArgument?.slice('--filters='.length)
  ?? process.env.LIGHTTABLE_FILTER_KINDS ?? '')
  .split(',').map((kind) => kind.trim()).filter(Boolean));
const filters = requestedKinds.size > 0
  ? allFilters.filter(([kind]) => requestedKinds.has(kind))
  : allFilters;
if (filters.length !== (requestedKinds.size || allFilters.length)) {
  const missing = [...requestedKinds].filter((kind) => !allFilters.some(([known]) => known === kind));
  throw new Error(`Unknown filter smoke kind(s): ${missing.join(', ')}`);
}

const canvasHash = (image) => createHash('sha256').update(image).digest('hex');
const waitForCanvasHash = async (page, canvas, expectedHash, shouldEqual, timeoutMs = 3_000) => {
  const startedAt = performance.now();
  let attempts = 0;
  let image = await canvas.screenshot();
  let hash = canvasHash(image);
  while ((hash === expectedHash) !== shouldEqual && performance.now() - startedAt < timeoutMs) {
    attempts += 1;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    image = await canvas.screenshot();
    hash = canvasHash(image);
  }
  return { image, hash, attempts, elapsedMs: performance.now() - startedAt };
};
const exportPng = async (driver, documentId) => {
  const started = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
  if (started.status !== 'accepted' || !started.taskId) {
    throw new Error('PNG export did not start an asynchronous task.');
  }
  const task = await driver.waitForTask(documentId, started.taskId, 60_000);
  if (!task.artifact?.id) throw new Error('PNG export completed without an artifact.');
  const artifact = await driver.readArtifact(task.artifact.id);
  if (!artifact) throw new Error('PNG export artifact could not be read.');
  return artifact.bytes;
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => errors.page.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  await page.setViewportSize({ width: 1000, height: 760 });
  const openFile = await waitForDesktopLauncher({
    app, page, outputDirectory: output, sourceFile: sourceFile ?? 'generated-filter-fixture',
    pageErrors: errors.page, label: 'filter'
  });
  if (sourceFile) {
    await openFile.click();
  } else {
    await page.getByRole('button', { name: 'New document' }).click();
    const newDocument = page.locator('form.lighttable-new-document-dialog');
    await newDocument.getByLabel('Width', { exact: true }).fill(String(documentWidth));
    await newDocument.getByLabel('Height', { exact: true }).fill(String(documentHeight));
    await page.getByRole('button', { name: 'Create', exact: true }).click();
  }
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  report.gpuAdapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const info = adapter.info;
    return {
      vendor: info?.vendor ?? '', architecture: info?.architecture ?? '',
      device: info?.device ?? '', description: info?.description ?? ''
    };
  });
  const driver = await attachLightTableAutomation(page, 'filter-smoke');
  const workspace = await driver.queryWorkspace();
  const documentId = workspace?.activeDocumentId;
  if (!documentId) throw new Error('Filter smoke has no active document.');
  const layers = await driver.queryLayers(documentId) ?? [];
  const raster = layers.find(({ type }) => type === 'raster');
  if (!raster) throw new Error('Filter smoke fixture has no raster layer.');

  if (!sourceFile) {
    await driver.execute(documentId, 'raster.applyGradient', {
      layerId: raster.id,
      channel: 'pixels',
      opacity: 1,
      blendMode: 'normal',
      paint: {
        kind: 'gradient', shape: 'linear', coordinateSpace: 'document',
        asset: {
          id: 'filter-spectrum', name: 'Filter spectrum', type: 'solid',
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
  }

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = page.locator('.lighttable-viewport__canvas');
  const baselineImage = await canvas.screenshot({ path: path.join(output, 'baseline.png') });
  const baselineHash = canvasHash(baselineImage);
  const baselineExportHash = canvasHash(await exportPng(driver, documentId));
  report.baselineCanvasSha256 = baselineHash;
  report.baselineExportSha256 = baselineExportHash;
  report.baselineEstimatedGpuBytes = (await driver.queryDocument(documentId))?.renderer?.estimatedGpuBytes ?? null;

  for (const [kind, baseSettings] of filters) {
    const settings = kind === 'displace' ? {
      horizontalScale: 18, verticalScale: -12, mapAssetId: raster.id,
      edgeMode: 'clamp', interpolation: 'bicubic'
    } : baseSettings;
    process.stdout.write(`Validating ${kind}: ${JSON.stringify(settings)}\n`);
    const startedAt = performance.now();
    const created = await driver.execute(documentId, 'adjustment.create', {
      kind, placement: 'adjustment-layer', aboveLayerId: raster.id,
      ...(settings ? { settings } : {})
    });
    const filterLayerId = created.value?.layerId;
    if (!filterLayerId) throw new Error(`${kind} did not return its adjustment-layer ID.`);
    const rendered = await waitForCanvasHash(page, canvas, baselineHash, false);
    const settledFrameMs = performance.now() - startedAt;
    await writeFile(path.join(output, `${kind}.png`), rendered.image);
    if (rendered.hash === baselineHash) {
      throw new Error(`${kind} rendered the unchanged baseline canvas despite non-neutral settings.`);
    }
    const exportSha256 = canvasHash(await exportPng(driver, documentId));
    if (exportSha256 === baselineExportHash) {
      throw new Error(`${kind} exported unchanged pixels despite non-neutral settings.`);
    }
    const documentState = await driver.queryDocument(documentId);
    report.filters.push({
      kind,
      settledFrameMs,
      renderWaitFrames: rendered.attempts,
      renderWaitMs: rendered.elapsedMs,
      screenshotSha256: rendered.hash,
      exportSha256,
      estimatedGpuBytes: documentState?.renderer?.estimatedGpuBytes ?? null
    });
    if (errors.page.length || errors.console.length) {
      throw new Error(`${kind} produced renderer errors: ${JSON.stringify(errors)}`);
    }
    await driver.execute(documentId, 'layer.delete', { layerIds: [filterLayerId] });
    const restoredExportHash = canvasHash(await exportPng(driver, documentId));
    if (restoredExportHash !== baselineExportHash) {
      await writeFile(path.join(output, `${kind}-restore-failure.png`), await canvas.screenshot());
      throw new Error(`${kind} left stale pixels behind after deleting its filter layer.`);
    }
  }

  report.firstPassPeakEstimatedGpuBytes = Math.max(
    ...report.filters.map(({ estimatedGpuBytes }) => estimatedGpuBytes ?? 0)
  );
  for (const [kind, baseSettings] of filters) {
    const settings = kind === 'displace' ? {
      horizontalScale: 18, verticalScale: -12, mapAssetId: raster.id,
      edgeMode: 'clamp', interpolation: 'bicubic'
    } : baseSettings;
    process.stdout.write(`Cleanup pass ${kind}\n`);
    const created = await driver.execute(documentId, 'adjustment.create', {
      kind, placement: 'adjustment-layer', aboveLayerId: raster.id,
      ...(settings ? { settings } : {})
    });
    const filterLayerId = created.value?.layerId;
    if (!filterLayerId) throw new Error(`${kind} cleanup pass did not return its layer ID.`);
    await waitForCanvasHash(page, canvas, baselineHash, false);
    const exportSha256 = canvasHash(await exportPng(driver, documentId));
    if (exportSha256 === baselineExportHash) {
      throw new Error(`${kind} cleanup pass exported unchanged pixels.`);
    }
    const estimatedGpuBytes = (await driver.queryDocument(documentId))?.renderer?.estimatedGpuBytes ?? null;
    if (estimatedGpuBytes !== null && estimatedGpuBytes > report.firstPassPeakEstimatedGpuBytes) {
      throw new Error(`${kind} grew GPU memory beyond the fully warmed first-pass peak.`);
    }
    report.cleanupPass.push({ kind, estimatedGpuBytes, exportSha256 });
    await driver.execute(documentId, 'layer.delete', { layerIds: [filterLayerId] });
    const restoredExportHash = canvasHash(await exportPng(driver, documentId));
    if (restoredExportHash !== baselineExportHash) {
      await writeFile(path.join(output, `${kind}-cleanup-restore-failure.png`), await canvas.screenshot());
      throw new Error(`${kind} cleanup pass left stale pixels behind.`);
    }
    if (errors.page.length || errors.console.length) {
      throw new Error(`${kind} cleanup pass produced renderer errors: ${JSON.stringify(errors)}`);
    }
  }

  report.finalEstimatedGpuBytes = (await driver.queryDocument(documentId))
    ?.renderer?.estimatedGpuBytes ?? null;
  if (report.finalEstimatedGpuBytes !== null
    && report.finalEstimatedGpuBytes > report.firstPassPeakEstimatedGpuBytes) {
    throw new Error('Final GPU memory exceeded the fully warmed first-pass peak.');
  }

  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Filter smoke passed: ${path.join(output, 'report.json')}\n`);
} finally {
  await app.close();
}
