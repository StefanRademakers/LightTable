import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const output = path.join(root, 'tmp', 'vector-authoring-smoke');
const launch = await resolveDesktopTestLaunch(root);
const beforeTransformPath = path.join(output, 'before-transform.png');
const originalPath = path.join(output, 'authored.png');
const reopenedPath = path.join(output, 'native-reopened.png');
const differencePath = path.join(output, 'native-difference.png');
const transformDifferencePath = path.join(output, 'transform-difference.png');
const reportPath = path.join(output, 'report.json');
await Promise.all([access(sourceFile), mkdir(output, { recursive: true })]);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
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

const waitForActiveDocument = async (driver, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  let workspace = await driver.queryWorkspace();
  while (!workspace?.activeDocumentId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    workspace = await driver.queryWorkspace();
  }
  if (!workspace?.activeDocumentId) throw new Error('No active document was published.');
  return workspace.activeDocumentId;
};

const exportArtifact = async (driver, documentId, command) => {
  const accepted = await driver.execute(documentId, command, {}, { requireCompleted: false });
  if (accepted.status !== 'accepted') throw new Error(`${command} did not start.`);
  const task = await driver.waitForTask(documentId, accepted.taskId, 60_000);
  if (!task.artifact) throw new Error(`${command} completed without an artifact.`);
  return task.artifact;
};

const exportPng = async (driver, documentId, targetPath) => {
  const artifact = await exportArtifact(driver, documentId, 'file.exportPng');
  const contents = await driver.readArtifact(artifact.id);
  if (!contents?.bytes) throw new Error('PNG export artifact has no readable bytes.');
  await writeFile(targetPath, contents.bytes);
};

const vectorSignature = (layer) => layer ? {
  transform: layer.transform,
  elements: layer.vectorContent?.elements.map((element) => ({
    elementType: element.elementType,
    fill: element.fill,
    stroke: element.stroke,
    opacity: element.opacity,
    transform: element.transform
  })) ?? null
} : null;

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

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openButton = await waitForDesktopLauncher({ app, page, outputDirectory: output,
    sourceFile, pageErrors, label: 'vector-authoring' });
  await openButton.click();
  const driver = await attachLightTableAutomation(page, 'vector-authoring');
  const documentId = await waitForActiveDocument(driver);
  await waitReady(driver, documentId);
  const backgroundLayer = page.locator('.lighttable-layer').filter({
    has: page.locator('.lighttable-layer__name[value="Background"]')
  }).first();
  await backgroundLayer.click();
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('No baseline document projection.');

  await page.keyboard.press('u');
  const rectangleTool = page.getByRole('button', { name: 'Rectangle (U)', exact: true });
  await rectangleTool.waitFor({ state: 'visible' });
  await rectangleTool.click();
  const viewport = page.locator('.lighttable-viewport:visible');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport has no bounds.');
  const startedAt = performance.now();
  await page.mouse.move(bounds.x + bounds.width * 0.38, bounds.y + bounds.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.56, { steps: 8 });
  const pointerUpAt = performance.now();
  await page.mouse.up();
  const authored = await driver.queryDocument(documentId);
  const firstShapeFrame = await driver.waitForRenderedDocument(documentId, 60_000);
  const firstShapeVisibleMs = performance.now() - pointerUpAt;
  const authoringMs = performance.now() - startedAt;
  const authoredLayers = await driver.queryLayers(documentId) ?? [];
  const authoredLayer = authoredLayers.find(({ id }) => id === authored?.activeLayerId);
  const authoredElement = authoredLayer?.vectorContent?.elements[0];
  if (!authored || authored.layerCount !== before.layerCount + 1
    || authored.history.undoDepth !== before.history.undoDepth + 1
    || authoredLayer?.type !== 'vector'
    || !authoredElement) {
    throw new Error(`Authored vector semantics are incomplete: ${JSON.stringify({
      before, authored, authoredLayer, pageErrors
    })}`);
  }
  await exportPng(driver, documentId, beforeTransformPath);

  // Keep this as a vertical user-path assertion. Controller mocks cannot prove
  // that a semantic transform moves the retained pixels and survives the
  // canonical checkpoint used by save/reopen.
  const transformBefore = authoredLayer.transform;
  const historyBeforeTransform = authored.history.undoDepth;
  await page.keyboard.press('v');
  const transformBody = page.locator('.lighttable-transform__body');
  await transformBody.waitFor({ state: 'visible' });
  const transformBounds = await transformBody.boundingBox();
  if (!transformBounds) throw new Error('Authored vector transform has no interactive cage.');
  const transformDx = 37;
  const transformDy = 23;
  const transformX = transformBounds.x + transformBounds.width / 2;
  const transformY = transformBounds.y + transformBounds.height / 2;
  await page.mouse.move(transformX, transformY);
  await page.mouse.down();
  await page.mouse.move(transformX + transformDx, transformY + transformDy, { steps: 5 });
  await page.mouse.up();
  const transformedDocument = await driver.queryDocument(documentId);
  await driver.waitForRenderedDocument(documentId, 60_000);
  const transformedLayers = await driver.queryLayers(documentId) ?? [];
  const transformedLayer = transformedLayers.find(({ id }) => id === authoredLayer.id);
  if (!transformedLayer
    || transformedLayer.transform.tx <= transformBefore.tx
    || transformedLayer.transform.ty <= transformBefore.ty
    || transformedDocument?.history.undoDepth !== historyBeforeTransform + 1) {
    throw new Error(`Vector transform did not commit through the visible tool path: ${JSON.stringify({
      before: transformBefore,
      after: transformedLayer?.transform,
      historyBeforeTransform,
      historyAfterTransform: transformedDocument?.history.undoDepth,
      pageErrors
    })}`);
  }
  await exportPng(driver, documentId, originalPath);
  const transformVisual = await comparePng(beforeTransformPath, originalPath, transformDifferencePath);
  if (transformVisual.changedChannelsAbove2 < 100) {
    throw new Error(`Canonical transform changed but rendered pixels did not move: ${JSON.stringify({
      transformBefore, transformAfter: transformedLayer.transform, transformVisual
    })}`);
  }
  const nativeStartedAt = performance.now();
  const nativeArtifact = await exportArtifact(driver, documentId, 'file.exportNative');
  const openedNative = await driver.executeWorkspace('file.openArtifact', { artifactId: nativeArtifact.id });
  const nativeId = openedNative.value.documentId;
  await waitReady(driver, nativeId);
  await driver.waitForRenderedDocument(nativeId, 60_000);
  await exportPng(driver, nativeId, reopenedPath);
  const nativeLayers = await driver.queryLayers(nativeId) ?? [];
  const nativeLayer = nativeLayers.find(({ name }) => name === transformedLayer.name);
  const nativeRoundTripMs = performance.now() - nativeStartedAt;
  if (JSON.stringify(vectorSignature(nativeLayer)) !== JSON.stringify(vectorSignature(transformedLayer))) {
    throw new Error(`Native vector signature changed: ${JSON.stringify({
      authored: vectorSignature(transformedLayer), reopened: vectorSignature(nativeLayer)
    })}`);
  }

  const psdArtifact = await exportArtifact(driver, nativeId, 'file.exportPsd');
  const openedPsd = await driver.executeWorkspace('file.openArtifact', { artifactId: psdArtifact.id });
  const psdId = openedPsd.value.documentId;
  await waitReady(driver, psdId);
  const psdLayers = await driver.queryLayers(psdId) ?? [];
  const psdLayer = psdLayers.find(({ name }) => name === transformedLayer.name);
  const psdElement = psdLayer?.vectorContent?.elements[0];
  if (!psdElement) {
    throw new Error(`PSD vector signature changed: ${JSON.stringify(psdLayer)}`);
  }

  const visual = await comparePng(originalPath, reopenedPath, differencePath);
  if (visual.rmse > 1.5 || pageErrors.length) {
    throw new Error(`Vector visual roundtrip failed: ${JSON.stringify({ visual, pageErrors })}`);
  }
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    authoringMs,
    firstShapeVisibleMs,
    firstShapeFrame: firstShapeFrame.telemetry,
    nativeRoundTripMs,
    gpuBytesBefore: before.renderer.estimatedGpuBytes,
    gpuBytesAfter: authored.renderer.estimatedGpuBytes,
    authoredSignature: vectorSignature(authoredLayer),
    nativeSignature: vectorSignature(nativeLayer),
    psdSignature: vectorSignature(psdLayer),
    transformVisual,
    visual,
    captures: { beforeTransformPath, originalPath, reopenedPath, differencePath, transformDifferencePath },
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Vector authoring smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
