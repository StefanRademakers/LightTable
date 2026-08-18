import { _electron as electron } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'point-color-range-smoke');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace, { requirePackaged: true });
const corpus = JSON.parse(await readFile(
  path.join(import.meta.dirname, 'grade-camera-raw-corpus.json'), 'utf8'
));
const caseManifestBytes = await readFile(
  path.join(import.meta.dirname, 'grade-point-color-parity-cases.json')
);
const evidenceDirectory = path.join(
  path.resolve(corpus.externalRoot), 'captures', 'point-color', 'native'
);
await Promise.all([
  mkdir(userData, { recursive: true }),
  mkdir(evidenceDirectory, { recursive: true })
]);

const sourceBytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512">
  <defs>
    <linearGradient id="hue"><stop stop-color="#f33"/><stop offset=".2" stop-color="#fd3"/><stop offset=".4" stop-color="#3d6"/><stop offset=".6" stop-color="#3cf"/><stop offset=".8" stop-color="#65e"/><stop offset="1" stop-color="#f3a"/></linearGradient>
    <linearGradient id="light" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#888"/><stop offset="1" stop-color="#000"/></linearGradient>
  </defs>
  <rect width="1024" height="512" fill="url(#hue)"/>
  <rect width="1024" height="512" fill="url(#light)" opacity=".72"/>
</svg>`)).png().toBuffer();

const environment = {
  ...process.env,
  LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_HEADLESS: '1'
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const driver = await attachLightTableAutomation(page, 'point-color-range-smoke', 30_000);
  const source = await driver.registerInputArtifact(
    sourceBytes,
    'point-color-range.svg.png',
    'image/png'
  );
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: source.id });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Point Color smoke received no document ID.');
  await driver.waitForDocument(documentId, 120_000);
  await driver.waitForLayers(documentId, 120_000);

  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  await page.waitForFunction(async (id) => {
    const document = window.__lightTableAutomation?.queryDocument(id);
    return document?.lifecycle === 'ready'
      && document.history.busy === false
      && document.tasks.activeCount === 0;
  }, documentId, { timeout: 30_000 });
  const panel = page.getByLabel('Grade Layer properties', { exact: true });
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const mixer = panel.locator('.lighttable-color-mixer');
  if (await mixer.count() === 0) {
    throw new Error(`Grade panel contains no Color Mixer controls: ${await panel.innerText()}`);
  }
  await mixer.scrollIntoViewIfNeeded();
  await mixer.getByRole('radio', { name: 'Point Color', exact: true }).click();
  await mixer.getByRole('button', { name: 'Sample Point Color from image', exact: true }).click();
  const viewport = page.locator('.lighttable-viewport');
  await viewport.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => (
    document.querySelector('.lighttable-viewport')?.classList.contains('lighttable-viewport--eyedropper')
  ), undefined, { timeout: 30_000 });
  const canvas = page.locator('.lighttable-viewport__canvas');
  const clickPoint = await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (const [xRatio, yRatio] of [[0.25, 0.25], [0.5, 0.5], [0.75, 0.25]]) {
      const x = bounds.left + bounds.width * xRatio;
      const y = bounds.top + bounds.height * yRatio;
      if (document.elementFromPoint(x, y)?.closest('.lighttable-viewport') === element) {
        return { x, y };
      }
    }
    return null;
  });
  if (!clickPoint) throw new Error('Point Color smoke found no unobstructed viewport point.');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  const visualize = mixer.getByRole('switch', { name: 'Visualize Point Color range' });
  try {
    await visualize.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    throw new Error(`Point Color sample was not created. Panel: ${await panel.innerText()}`);
  }

  const exportPng = async () => {
    const request = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, request.taskId, 120_000);
    const artifact = task.artifact && await driver.readArtifact(task.artifact.id);
    if (!artifact) throw new Error('Point Color smoke export produced no artifact.');
    return Buffer.from(artifact.bytes);
  };
  const cleanExport = await exportPng();
  await driver.resetRenderTelemetry(documentId);
  await visualize.click();
  await page.waitForFunction((element) => element.getAttribute('aria-checked') === 'true',
    await visualize.elementHandle(), { timeout: 30_000 });
  await page.waitForFunction(async (id) => {
    const telemetry = window.__lightTableAutomation?.queryRenderTelemetry?.(id);
    return (telemetry?.submittedFrames ?? 0) > 0
      && (telemetry?.stages?.viewport?.executions ?? 0) > 0;
  }, documentId, { timeout: 30_000 });
  const captureViewport = async () => {
    const bounds = await viewport.boundingBox();
    if (!bounds) throw new Error('Point Color smoke lost the viewport bounds.');
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await page.screenshot({ clip: bounds, animations: 'disabled', timeout: 45_000 });
      } catch (error) {
        lastError = error;
        if (attempt === 0) await page.waitForTimeout(250);
      }
    }
    throw lastError;
  };
  const preview = await captureViewport();
  const previewImage = sharp(preview);
  const previewMetadata = await previewImage.metadata();
  const viewportBounds = await viewport.boundingBox();
  if (!viewportBounds) throw new Error('Point Color smoke lost the viewport bounds.');
  const screenshotScaleX = (previewMetadata.width ?? 1) / viewportBounds.width;
  const screenshotScaleY = (previewMetadata.height ?? 1) / viewportBounds.height;
  const sampleX = (clickPoint.x - viewportBounds.x) * screenshotScaleX;
  const sampleY = (clickPoint.y - viewportBounds.y) * screenshotScaleY;
  const cropWidth = Math.min(240, previewMetadata.width ?? 1);
  const cropHeight = Math.min(180, previewMetadata.height ?? 1);
  const previewCrop = previewImage.extract({
    left: Math.max(0, Math.min(
      (previewMetadata.width ?? 1) - cropWidth,
      Math.floor(sampleX - cropWidth / 2)
    )),
    top: Math.max(0, Math.min(
      (previewMetadata.height ?? 1) - cropHeight,
      Math.floor(sampleY - cropHeight / 2)
    )),
    width: cropWidth,
    height: cropHeight
  });
  const previewStats = await previewCrop.clone().stats();
  const { data: previewPixels, info: previewInfo } = await previewCrop
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let colorfulPixels = 0;
  for (let offset = 0; offset < previewPixels.length; offset += previewInfo.channels) {
    const r = previewPixels[offset];
    const g = previewPixels[offset + 1];
    const b = previewPixels[offset + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 4) colorfulPixels += 1;
  }
  const colorfulRatio = colorfulPixels / (previewInfo.width * previewInfo.height);
  const channelSpread = Math.max(
    Math.abs(previewStats.channels[0].mean - previewStats.channels[1].mean),
    Math.abs(previewStats.channels[1].mean - previewStats.channels[2].mean),
    Math.abs(previewStats.channels[0].mean - previewStats.channels[2].mean)
  );
  if (colorfulRatio > 0.01) {
    throw new Error(`Visualize Range is not grayscale; colorful pixel ratio=${colorfulRatio.toFixed(4)}, channel mean spread=${channelSpread.toFixed(3)}.`);
  }
  if (previewStats.channels[0].stdev < 4) {
    throw new Error('Visualize Range produced no useful black/gray/white range variation.');
  }
  const diagnosticExport = await exportPng();
  if (!cleanExport.equals(diagnosticExport)) {
    throw new Error(`Visualize Range contaminated export: ${hash(cleanExport)} != ${hash(diagnosticExport)}.`);
  }

  const hueRange = mixer.getByRole('slider', { name: 'Hue Range', exact: true });
  await driver.resetRenderTelemetry(documentId);
  await hueRange.fill('5');
  await page.waitForFunction((element) => element.value === '5',
    await hueRange.elementHandle(), { timeout: 30_000 });
  await page.waitForFunction(async (id) => {
    const telemetry = window.__lightTableAutomation?.queryRenderTelemetry?.(id);
    return (telemetry?.submittedFrames ?? 0) > 0
      && (telemetry?.stages?.viewport?.executions ?? 0) > 0;
  }, documentId, { timeout: 30_000 });
  const narrowedPreview = await captureViewport();
  if (preview.equals(narrowedPreview)) {
    throw new Error('Hue Range did not update the diagnostic viewport.');
  }
  await visualize.click();
  if (await visualize.getAttribute('aria-checked') !== 'false') {
    throw new Error('Visualize Range did not exit deterministically.');
  }

  const renderControl = async (label, value) => {
    const slider = mixer.getByRole('slider', { name: label, exact: true });
    await driver.resetRenderTelemetry(documentId);
    await slider.fill(String(value));
    if (await slider.inputValue() !== String(value)) {
      throw new Error(`${label} did not settle at ${value}.`);
    }
    await page.waitForFunction(async (id) => {
      const telemetry = window.__lightTableAutomation?.queryRenderTelemetry?.(id);
      return (telemetry?.submittedFrames ?? 0) > 0;
    }, documentId, { timeout: 30_000 });
    return exportPng();
  };
  const requireChanged = (label, left, right) => {
    if (left.equals(right)) throw new Error(`${label} produced no visible export change.`);
  };

  await renderControl('Hue Range', 50);
  const hueEffect = await renderControl('Hue Shift', 80);
  requireChanged('Hue Shift', cleanExport, hueEffect);
  const hueReset = await renderControl('Hue Shift', 0);
  if (!cleanExport.equals(hueReset)) throw new Error('Reset Hue Shift is not an exact bypass.');
  const saturationEffect = await renderControl('Saturation Shift', -80);
  requireChanged('Saturation Shift', cleanExport, saturationEffect);
  await renderControl('Saturation Shift', 0);
  const luminanceEffect = await renderControl('Luminance Shift', 80);
  requireChanged('Luminance Shift', cleanExport, luminanceEffect);
  await renderControl('Luminance Shift', 0);
  const broadHue = await renderControl('Hue Shift', 80);
  const varianceEffect = await renderControl('Variance', 80);
  requireChanged('Variance', broadHue, varianceEffect);
  const narrowHue = await renderControl('Hue Range', 5);
  requireChanged('Hue Range', varianceEffect, narrowHue);

  await mixer.getByRole('button', { name: 'Sample Point Color from image', exact: true }).click();
  const secondPoint = await viewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width * 0.75;
    const y = bounds.top + bounds.height * 0.25;
    return document.elementFromPoint(x, y)?.closest('.lighttable-viewport') === element
      ? { x, y }
      : null;
  });
  if (!secondPoint) throw new Error('Point Color smoke found no second sample point.');
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.waitForFunction(() => (
    document.querySelectorAll('[aria-label="Select sampled color"]').length === 2
  ), undefined, { timeout: 30_000 });
  const overlapEffect = await renderControl('Hue Shift', -80);
  requireChanged('Overlapping Point Color samples', narrowHue, overlapEffect);

  const remove = mixer.getByRole('button', { name: 'Remove sampled color', exact: true });
  await remove.click();
  await mixer.getByRole('button', { name: 'Select sampled color', exact: true }).first().click();
  await remove.click();
  const removedAll = await exportPng();
  if (!cleanExport.equals(removedAll)) {
    throw new Error('Removing all Point Color samples did not restore the exact baseline.');
  }
  if (runtimeErrors.length > 0) {
    throw new Error(`Point Color smoke emitted runtime errors: ${JSON.stringify(runtimeErrors)}`);
  }
  await writeFile(path.join(evidenceDirectory, 'capture-report.json'), `${JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    section: 'point-color',
    caseManifestSha256: hash(caseManifestBytes),
    packagedDesktop: launch.mode === 'production-packaged',
    passed: true,
    sourceEvidence: { sha256: hash(sourceBytes), byteLength: sourceBytes.byteLength },
    cases: [
      { id: 'neutral-sample', sha256: hash(cleanExport) },
      { id: 'hue-plus-80', sha256: hash(hueEffect) },
      { id: 'hue-reset', sha256: hash(hueReset) },
      { id: 'saturation-minus-80', sha256: hash(saturationEffect) },
      { id: 'luminance-plus-80', sha256: hash(luminanceEffect) },
      { id: 'variance-plus-80', sha256: hash(varianceEffect) },
      { id: 'narrow-hue-range', sha256: hash(narrowHue) },
      { id: 'visualize-range', exportSha256: hash(diagnosticExport), viewportSha256: hash(preview) },
      { id: 'overlapping-samples', sha256: hash(overlapEffect) },
      { id: 'remove-all', sha256: hash(removedAll) }
    ]
  }, null, 2)}\n`);
  process.stdout.write(`Point Color range smoke passed; clean export ${hash(cleanExport)}.\n`);
} finally {
  await app.close().catch(() => undefined);
}
