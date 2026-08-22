import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import {
  resolveDesktopTestLaunch,
  waitForDesktopLauncher
} from './desktop-test-startup.mjs';

const root = path.resolve(import.meta.dirname, '..');
const firstFile = path.resolve(process.argv[2] ?? path.join(root, 'architecture', 'ui', '1.png'));
const secondFile = path.resolve(process.argv[3] ?? path.join(root, 'icon', 'logo_emblem.png'));
const output = path.join(root, 'tmp', 'document-pixel-retention-smoke');
const reportPath = path.join(output, 'report.json');
await Promise.all([access(firstFile), access(secondFile), mkdir(output, { recursive: true })]);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(root);
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: root,
  env: {
    ...environment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: firstFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: path.join(output, `user-data-${process.pid}`),
    LIGHTTABLE_AUTOMATION_HEADLESS: '1'
  },
  timeout: 30_000
});

const assertRetained = (label, baseline, current) => {
  if (current.alpha === 0 || current.opaque === 0 || current.rgb === 0) {
    throw new Error(`${label} became transparent: ${JSON.stringify({ baseline, current })}`);
  }
  if (current.width !== baseline.width || current.height !== baseline.height
    || current.alpha !== baseline.alpha || current.opaque !== baseline.opaque) {
    throw new Error(`${label} pixel geometry/coverage changed: ${JSON.stringify({ baseline, current })}`);
  }
  const rgbDelta = Math.abs(current.rgb - baseline.rgb) / Math.max(1, baseline.rgb);
  if (rgbDelta > 0.02) {
    throw new Error(`${label} pixel content changed by ${(rgbDelta * 100).toFixed(2)}%: ${JSON.stringify({ baseline, current })}`);
  }
};

const mimeTypeFor = (file) => ({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
}[path.extname(file).toLowerCase()] ?? 'application/octet-stream');

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const open = await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile: firstFile,
    pageErrors,
    label: 'document-pixel-retention'
  });
  await open.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'document-pixel-retention');
  const firstId = (await driver.queryWorkspace()).activeDocumentId;
  if (!firstId) throw new Error('The first document did not become active.');

  const previewMetrics = async (documentId, format) => {
    const documentState = await driver.queryDocument(documentId);
    const preview = await page.evaluate((request) => window.__lightTableAutomation
      ?.requestDocumentPreview(request), {
      documentId,
      expectedDocumentRevision: documentState.canonicalRevision,
      maxEdge: 512,
      format
    });
    if (preview?.status !== 'completed') {
      throw new Error(`Preview failed: ${JSON.stringify(preview)}`);
    }
    return page.evaluate(async (artifactId) => {
      const file = window.__lightTableAutomation?.resolveArtifact(artifactId);
      if (!file) throw new Error('Preview artifact disappeared.');
      const bitmap = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let alpha = 0;
      let rgb = 0;
      let opaque = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        alpha += pixels[index + 3];
        rgb += pixels[index] + pixels[index + 1] + pixels[index + 2];
        if (pixels[index + 3] > 0) opaque += 1;
      }
      bitmap.close();
      return { width: canvas.width, height: canvas.height, alpha, rgb, opaque };
    }, preview.artifact.id);
  };

  const firstBaseline = await previewMetrics(firstId, 'png');
  const firstLayerIds = (await driver.queryLayers(firstId)).map((layer) => layer.id);
  const secondBytes = await readFile(secondFile);
  const secondArtifact = await driver.registerInputArtifact(
    secondBytes,
    path.basename(secondFile),
    mimeTypeFor(secondFile)
  );
  await driver.executeWorkspace('file.openArtifact', { artifactId: secondArtifact.id });
  const secondId = (await driver.queryWorkspace()).activeDocumentId;
  if (!secondId || secondId === firstId) throw new Error('The second document did not open.');
  await driver.waitForDocument(secondId, 60_000);
  const secondBaseline = await previewMetrics(secondId, 'png');
  const secondLayerIds = (await driver.queryLayers(secondId)).map((layer) => layer.id);

  // A document-addressed semantic mutation must not use tab activation as its
  // transport. Keep the second document visible while editing the first, then
  // prove canonical state/revision/history changed only on the requested ID.
  const inactiveTargetId = firstLayerIds.at(-1);
  if (!inactiveTargetId) throw new Error('The first document has no editable layer.');
  const inactiveBefore = await driver.queryDocument(firstId);
  await driver.execute(firstId, 'layer.rename', {
    layerId: inactiveTargetId,
    name: 'Inactive document edit'
  });
  const inactiveAfter = await driver.queryDocument(firstId);
  const workspaceAfterInactiveEdit = await driver.queryWorkspace();
  const inactiveLayer = (await driver.queryLayers(firstId))
    .find(({ id }) => id === inactiveTargetId);
  if (workspaceAfterInactiveEdit.activeDocumentId !== secondId) {
    throw new Error('Editing an inactive document changed the visible document.');
  }
  if (inactiveAfter.canonicalRevision !== inactiveBefore.canonicalRevision + 1
    || inactiveAfter.history.undoDepth !== inactiveBefore.history.undoDepth + 1
    || inactiveLayer?.name !== 'Inactive document edit') {
    throw new Error(`Inactive document mutation was not canonical: ${JSON.stringify({
      inactiveBefore, inactiveAfter, inactiveLayer
    })}`);
  }

  const firstTab = page.getByRole('tab', { name: new RegExp(path.basename(firstFile), 'i') });
  const secondTab = page.getByRole('tab', { name: new RegExp(path.basename(secondFile), 'i') });
  const photoWorkspace = page.getByRole('radio', { name: 'Switch to Photo edit workspace' });
  const gradingWorkspace = page.getByRole('radio', { name: 'Switch to Grading workspace' });
  const genAiWorkspace = page.getByRole('radio', { name: 'Switch to Gen AI workspace' });
  const cycles = [];

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await (cycle % 2 === 0 ? genAiWorkspace : gradingWorkspace).click();
    await page.keyboard.press(cycle % 2 === 0 ? 'p' : 'b');
    await firstTab.click();
    await page.waitForFunction((id) => window.__lightTableAutomation
      ?.queryWorkspace()?.activeDocumentId === id, firstId);
    const firstCurrent = await previewMetrics(firstId, cycle % 2 === 0 ? 'webp' : 'png');
    assertRetained(`First document after cycle ${cycle + 1}`, firstBaseline, firstCurrent);
    const firstCurrentLayerIds = (await driver.queryLayers(firstId)).map((layer) => layer.id);
    if (JSON.stringify(firstCurrentLayerIds) !== JSON.stringify(firstLayerIds)) {
      throw new Error(`First document layer identity changed: ${JSON.stringify({ firstLayerIds, firstCurrentLayerIds })}`);
    }

    await photoWorkspace.click();
    await page.keyboard.press(cycle % 2 === 0 ? 'm' : 'p');
    await secondTab.click();
    await page.waitForFunction((id) => window.__lightTableAutomation
      ?.queryWorkspace()?.activeDocumentId === id, secondId);
    const secondCurrent = await previewMetrics(secondId, cycle % 2 === 0 ? 'webp' : 'png');
    assertRetained(`Second document after cycle ${cycle + 1}`, secondBaseline, secondCurrent);
    const secondCurrentLayerIds = (await driver.queryLayers(secondId)).map((layer) => layer.id);
    if (JSON.stringify(secondCurrentLayerIds) !== JSON.stringify(secondLayerIds)) {
      throw new Error(`Second document layer identity changed: ${JSON.stringify({ secondLayerIds, secondCurrentLayerIds })}`);
    }
    cycles.push({ cycle: cycle + 1, first: firstCurrent, second: secondCurrent });
  }

  if (pageErrors.length > 0) {
    throw new Error(`Renderer errors occurred: ${JSON.stringify(pageErrors)}`);
  }
  const report = {
    launchMode: launch.mode,
    first: { file: firstFile, documentId: firstId, baseline: firstBaseline },
    second: { file: secondFile, documentId: secondId, baseline: secondBaseline },
    inactiveCommand: {
      targetDocumentId: firstId,
      visibleDocumentId: workspaceAfterInactiveEdit.activeDocumentId,
      layerId: inactiveTargetId,
      canonicalRevision: inactiveAfter.canonicalRevision,
      undoDepth: inactiveAfter.history.undoDepth
    },
    cycles,
    pageErrors
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Document pixel-retention smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
