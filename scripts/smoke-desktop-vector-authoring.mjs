import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'vector-authoring-smoke');
const executablePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const originalPath = path.join(output, 'authored.png');
const reopenedPath = path.join(output, 'native-reopened.png');
const differencePath = path.join(output, 'native-difference.png');
const reportPath = path.join(output, 'report.json');
await Promise.all([access(sourceFile), access(executablePath), mkdir(output, { recursive: true })]);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(root, 'apps', 'desktop')],
  cwd: root,
  env: {
    ...env,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`)
  },
  timeout: 30_000
});

const waitReady = async (driver, documentId) => {
  const deadline = Date.now() + 60_000;
  let snapshot = await driver.queryDocument(documentId);
  while (snapshot?.lifecycle !== 'ready' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    snapshot = await driver.queryDocument(documentId);
  }
  if (snapshot?.lifecycle !== 'ready') throw new Error(`Document ${documentId} did not become ready.`);
  return snapshot;
};

const exportArtifact = async (driver, documentId, command) => {
  const accepted = await driver.execute(documentId, command, {}, { requireCompleted: false });
  if (accepted.status !== 'accepted') throw new Error(`${command} did not start.`);
  const task = await driver.waitForTask(documentId, accepted.taskId, 60_000);
  if (!task.artifact) throw new Error(`${command} completed without an artifact.`);
  return task.artifact;
};

const vectorSignature = (layer) => layer?.vectorContent?.elements.map((element) => ({
  elementType: element.elementType,
  fill: element.fill,
  stroke: element.stroke,
  opacity: element.opacity,
  transform: element.transform
})) ?? null;

const comparePng = async (leftPath, rightPath, targetPath) => {
  const left = await sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
    throw new Error('Native reopen captures have different dimensions.');
  }
  const difference = Buffer.alloc(left.data.length);
  let squared = 0;
  let changed = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    const delta = Math.abs(left.data[index] - right.data[index]);
    difference[index] = delta;
    if (index % 4 !== 3) {
      squared += delta * delta;
      if (delta > 2) changed += 1;
    }
  }
  await sharp(difference, { raw: left.info }).png().toFile(targetPath);
  return {
    width: left.info.width,
    height: left.info.height,
    rmse: Math.sqrt(squared / (left.info.width * left.info.height * 3)),
    changedChannelsAbove2: changed
  };
};

const captureDocumentPixels = async (page, driver, documentId, document, targetPath) => {
  if (!document.canvas) throw new Error(`Document ${documentId} has no canvas metadata.`);
  await driver.execute(documentId, 'view.setZoom', { mode: 'custom', percent: 100 });
  await page.waitForTimeout(350);
  const viewport = await page.locator('.lighttable-viewport:visible').boundingBox();
  if (!viewport) throw new Error(`Document ${documentId} has no visible viewport.`);
  const { width, height } = document.canvas;
  await page.screenshot({
    path: targetPath,
    clip: {
      x: Math.round(viewport.x + (viewport.width - width) / 2),
      y: Math.round(viewport.y + (viewport.height - height) / 2),
      width,
      height
    }
  });
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'vector-authoring');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const backgroundLayer = page.locator('.lighttable-layer').filter({
    has: page.locator('.lighttable-layer__name[value="Background"]')
  }).first();
  await backgroundLayer.click();
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('No baseline document projection.');

  await page.keyboard.press('u');
  await page.getByRole('button', { name: 'Rectangle (U)', exact: true })
    .waitFor({ state: 'visible' });
  const style = page.locator('[aria-label="Vector style"]');
  const color = (label) => style.locator('.lighttable-tool-options__color-field')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('input[type="color"]');
  await style.getByLabel('Fill: enabled').uncheck();
  await color('Fill').fill('#336699');
  await style.getByLabel('Line: enabled').uncheck();
  await color('Line').fill('#ff8800');
  if (!await style.getByLabel('Fill: enabled').isChecked()
    || !await style.getByLabel('Line: enabled').isChecked()) {
    throw new Error('Choosing a fill or stroke color did not enable that paint intent.');
  }
  await style.getByRole('button', { name: 'Edit fill gradient' }).click();
  await page.getByRole('dialog', { name: 'Fill gradient' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close fill gradient' }).click();
  await style.getByRole('button', { name: 'Edit stroke gradient' }).click();
  await page.getByRole('dialog', { name: 'Stroke gradient' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close stroke gradient' }).click();
  const number = (label) => style.locator('.lighttable-tool-options__weight-field')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('input');
  await number('Weight').fill('200');
  await number('Line opacity').fill('40');
  await number('Opacity').fill('75');
  await style.getByLabel('Stroke alignment').selectOption('outside');
  await style.getByLabel('Stroke cap').selectOption('square');
  await style.getByLabel('Stroke join').selectOption('miter');
  await number('Miter').fill('12');

  const viewport = page.locator('.lighttable-viewport:visible');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport has no bounds.');
  const startedAt = performance.now();
  await page.mouse.move(bounds.x + bounds.width * 0.38, bounds.y + bounds.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.56, { steps: 8 });
  await page.mouse.up();
  const authored = await driver.queryDocument(documentId);
  const authoringMs = performance.now() - startedAt;
  const authoredLayers = await driver.queryLayers(documentId) ?? [];
  const authoredLayer = authoredLayers.find(({ id }) => id === authored?.activeLayerId);
  const authoredElement = authoredLayer?.vectorContent?.elements[0];
  if (!authored || authored.layerCount !== before.layerCount + 1
    || authored.history.undoDepth !== before.history.undoDepth + 1
    || authoredLayer?.type !== 'vector'
    || authoredElement?.fill !== 'gradient'
    || authoredElement.stroke?.paint !== 'gradient'
    || authoredElement.stroke.width !== 200
    || authoredElement.stroke.opacity !== 0.4
    || authoredElement.stroke.alignment !== 'outside'
    || authoredElement.stroke.cap !== 'square'
    || authoredElement.stroke.join !== 'miter'
    || authoredElement.stroke.miterLimit !== 12
    || authoredElement.opacity !== 0.75) {
    throw new Error(`Authored vector semantics are incomplete: ${JSON.stringify({
      before, authored, authoredLayer, pageErrors
    })}`);
  }

  await page.keyboard.press('h');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  await page.keyboard.press('f');
  await page.locator('.lighttable--canvas-only').waitFor({ state: 'visible' });
  await captureDocumentPixels(page, driver, documentId, authored, originalPath);
  const nativeStartedAt = performance.now();
  const nativeArtifact = await exportArtifact(driver, documentId, 'file.exportNative');
  const openedNative = await driver.execute(documentId, 'file.openArtifact', { artifactId: nativeArtifact.id });
  const nativeId = openedNative.value.documentId;
  const nativeDocument = await waitReady(driver, nativeId);
  await captureDocumentPixels(page, driver, nativeId, nativeDocument, reopenedPath);
  const nativeLayers = await driver.queryLayers(nativeId) ?? [];
  const nativeLayer = nativeLayers.find(({ name }) => name === authoredLayer.name);
  const nativeRoundTripMs = performance.now() - nativeStartedAt;
  if (JSON.stringify(vectorSignature(nativeLayer)) !== JSON.stringify(vectorSignature(authoredLayer))) {
    throw new Error(`Native vector signature changed: ${JSON.stringify({
      authored: vectorSignature(authoredLayer), reopened: vectorSignature(nativeLayer)
    })}`);
  }

  const psdArtifact = await exportArtifact(driver, nativeId, 'file.exportPsd');
  const openedPsd = await driver.execute(nativeId, 'file.openArtifact', { artifactId: psdArtifact.id });
  const psdId = openedPsd.value.documentId;
  await waitReady(driver, psdId);
  const psdLayers = await driver.queryLayers(psdId) ?? [];
  const psdLayer = psdLayers.find(({ name }) => name === authoredLayer.name);
  const psdElement = psdLayer?.vectorContent?.elements[0];
  if (!psdElement || psdElement.fill !== 'gradient' || psdElement.stroke?.paint !== 'gradient'
    || psdElement.stroke.width !== 200 || psdElement.stroke.opacity !== 0.3
    || psdElement.stroke.alignment !== 'outside' || psdElement.stroke.cap !== 'square'
    || psdElement.stroke.join !== 'miter' || psdElement.stroke.miterLimit !== 12) {
    throw new Error(`PSD vector signature changed: ${JSON.stringify(psdLayer)}`);
  }

  const visual = await comparePng(originalPath, reopenedPath, differencePath);
  if (visual.rmse > 1.5 || pageErrors.length) {
    throw new Error(`Vector visual roundtrip failed: ${JSON.stringify({ visual, pageErrors })}`);
  }
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    authoringMs,
    nativeRoundTripMs,
    gpuBytesBefore: before.renderer.estimatedGpuBytes,
    gpuBytesAfter: authored.renderer.estimatedGpuBytes,
    authoredSignature: vectorSignature(authoredLayer),
    nativeSignature: vectorSignature(nativeLayer),
    psdSignature: vectorSignature(psdLayer),
    visual,
    captures: { originalPath, reopenedPath, differencePath },
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Vector authoring smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
