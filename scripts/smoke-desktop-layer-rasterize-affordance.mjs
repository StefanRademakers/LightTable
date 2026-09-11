import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\RandomFiles\\0054_leeuw_3d_transparent.webp');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'layer-rasterize-affordance');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const reportPath = path.join(outputDirectory, 'report.json');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspaceRoot,
  env: {
    ...launchEnvironment,
    LIGHTTABLE_AUTOMATION_OPEN_FILE: sourceFile,
    LIGHTTABLE_AUTOMATION_USER_DATA: userDataPath
  },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory,
    sourceFile, pageErrors, label: 'layer-rasterize-affordance' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'layer-rasterize-affordance');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const initial = await driver.waitForRenderedDocument(documentId);
  const initialLayers = await driver.queryLayers(documentId) ?? [];
  const sourceLayer = initialLayers.find(({ type }) => type === 'raster');
  if (!sourceLayer) throw new Error('The fixture has no raster layer.');

  const observations = [];
  const canvas = page.locator('.lighttable-viewport__canvas');
  const comparePixels = async (before, after) => {
    const left = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const right = await sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
      return { changedPixelRatio: 1, rmse: Number.POSITIVE_INFINITY };
    }
    let changed = 0;
    let squaredError = 0;
    for (let index = 0; index < left.data.length; index += 4) {
      if (left.data[index] !== right.data[index]
        || left.data[index + 1] !== right.data[index + 1]
        || left.data[index + 2] !== right.data[index + 2]
        || left.data[index + 3] !== right.data[index + 3]) changed += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = left.data[index + channel] - right.data[index + channel];
        squaredError += delta * delta;
      }
    }
    return {
      changedPixelRatio: changed / (left.info.width * left.info.height),
      rmse: Math.sqrt(squaredError / left.data.length)
    };
  };
  const capturePresentedPixels = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(() => requestAnimationFrame(resolve))
    )));
    const panel = page.locator('.lighttable-layers-panel');
    await panel.evaluate((element) => { element.style.visibility = 'hidden'; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const pixels = await canvas.screenshot();
    await panel.evaluate((element) => { element.style.visibility = ''; });
    return pixels;
  };
  const readDocumentPreview = async (region) => {
    const state = await driver.queryDocument(documentId);
    const preview = await page.evaluate((request) => (
      window.__lightTableAutomation?.requestDocumentPreview(request) ?? null
    ), {
      documentId,
      expectedDocumentRevision: state.canonicalRevision,
      maxEdge: 1_024,
      ...(region ? { region } : {})
    });
    const artifact = await driver.readArtifact(preview?.artifact?.id ?? preview?.id);
    if (!artifact?.bytes?.length) throw new Error('Document preview returned no pixel artifact.');
    return artifact.bytes;
  };
  const selectLayer = async (layerId) => {
    await page.locator(`[data-layer-id="${layerId}"] .lighttable-layer__name`).click();
    await page.waitForFunction(({ documentId, layerId }) => (
      window.__lightTableAutomation?.queryDocument(documentId)?.activeLayerId === layerId
    ), { documentId, layerId });
  };
  const assertAffordance = async (label, layerId, expected = true) => {
    await selectLayer(layerId);
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    const button = row.locator('.lighttable-layer__rasterize');
    const state = await row.evaluate((element) => {
      const rasterize = element.querySelector('.lighttable-layer__rasterize');
      const rowBounds = element.getBoundingClientRect();
      const buttonBounds = rasterize?.getBoundingClientRect() ?? null;
      const hitTarget = buttonBounds
        ? document.elementFromPoint(
          buttonBounds.left + (buttonBounds.width / 2),
          buttonBounds.top + (buttonBounds.height / 2)
        )
        : null;
      return {
        html: element.outerHTML,
        rowBounds: rowBounds.toJSON(),
        buttonBounds: buttonBounds?.toJSON() ?? null,
        buttonInsideRow: Boolean(buttonBounds
          && buttonBounds.left >= rowBounds.left
          && buttonBounds.right <= rowBounds.right),
        buttonHitTestable: Boolean(rasterize && hitTarget && rasterize.contains(hitTarget))
      };
    });
    const count = await button.count();
    const visible = count === 1
      && await button.isVisible()
      && state.buttonInsideRow
      && state.buttonHitTestable;
    observations.push({ label, layerId, count, visible, state });
    if (visible !== expected) {
      throw new Error(`${label}: expected rasterize affordance ${expected ? 'visible' : 'absent'}, got ${JSON.stringify({ count, visible, state })}`);
    }
  };

  await assertAffordance('plain-raster', sourceLayer.id, false);

  const gradientResult = await driver.execute(documentId, 'layer.createGradientFill', {});
  const gradientId = gradientResult.value?.layerId;
  if (typeof gradientId !== 'string') throw new Error('Gradient Fill returned no layer ID.');
  await assertAffordance('gradient-fill', gradientId);
  const gradientRasterize = await driver.execute(documentId, 'layer.rasterize', { layerId: gradientId });
  const rasterizedGradientId = gradientRasterize.value?.layerId
    ?? (await driver.queryDocument(documentId))?.activeLayerId;
  const rasterizedGradient = (await driver.queryLayers(documentId) ?? [])
    .find(({ id }) => id === rasterizedGradientId);
  if (rasterizedGradient?.type !== 'raster') {
    throw new Error(`Gradient Fill did not become raster content: ${JSON.stringify({
      gradientRasterize: gradientRasterize.value,
      rasterizedGradientId,
      rasterizedGradient
    })}`);
  }
  const copyBounds = { x: 100, y: 100, width: 200, height: 180 };
  await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [sourceLayer.id],
    visible: false
  });
  const gradientOnlyPreview = await readDocumentPreview(copyBounds);
  const gradientPreviewMetadata = await sharp(gradientOnlyPreview).metadata();
  if (gradientPreviewMetadata.width !== copyBounds.width
    || gradientPreviewMetadata.height !== copyBounds.height) {
    throw new Error(`Gradient preview has unexpected dimensions: ${JSON.stringify(gradientPreviewMetadata)}`);
  }
  const expectedGradientSelection = gradientOnlyPreview;
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'selection.applyShape', {
    mode: 'replace',
    shape: { kind: 'rectangle', points: [
      { x: copyBounds.x, y: copyBounds.y },
      { x: copyBounds.x + copyBounds.width, y: copyBounds.y + copyBounds.height }
    ] },
    featherRadius: 0,
    antiAlias: false
  });
  const copiedGradient = await driver.execute(documentId, 'selection.copyPixels', {
    source: 'active-layer'
  });
  if (JSON.stringify(copiedGradient.value?.bounds) !== JSON.stringify(copyBounds)) {
    throw new Error(`Rasterized Gradient Fill copied unexpected bounds: ${JSON.stringify(copiedGradient.value)}`);
  }
  const copiedArtifactId = copiedGradient.value?.artifact?.id;
  const copiedArtifact = await driver.readArtifact(copiedArtifactId);
  if (typeof copiedArtifactId !== 'string' || !copiedArtifact?.bytes?.length) {
    throw new Error('Rasterized Gradient Fill returned no pixel clipboard artifact.');
  }
  const copiedGradientPixels = await sharp(copiedArtifact.bytes)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonTransparentCopiedPixels = 0;
  for (let index = 3; index < copiedGradientPixels.data.length; index += 4) {
    if (copiedGradientPixels.data[index] > 0) nonTransparentCopiedPixels += 1;
  }
  const copiedVersusSource = await comparePixels(expectedGradientSelection, copiedArtifact.bytes);
  if (nonTransparentCopiedPixels === 0 || copiedVersusSource.rmse > 2) {
    throw new Error(`Gradient clipboard pixels do not match the selected raster source: ${JSON.stringify({
      nonTransparentCopiedPixels,
      copiedVersusSource
    })}`);
  }
  const pastedGradient = await driver.execute(documentId, 'selection.pastePixels', {
    artifactId: copiedArtifactId,
    bounds: copyBounds,
    name: 'Pasted Selection'
  });
  const pastedGradientId = pastedGradient.value?.layerId;
  const pastedGradientLayer = (await driver.queryLayers(documentId) ?? [])
    .find(({ id }) => id === pastedGradientId);
  if (pastedGradientLayer?.type !== 'raster') {
    throw new Error(`Rasterized Gradient Fill selection did not paste as raster: ${JSON.stringify(pastedGradient.value)}`);
  }
  await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [sourceLayer.id, rasterizedGradientId],
    visible: false
  });
  const pastedSelectionPixels = await readDocumentPreview(copyBounds);
  const pastedVersusClipboard = await comparePixels(copiedArtifact.bytes, pastedSelectionPixels);
  if (pastedVersusClipboard.rmse > 2) {
    throw new Error(`Pasted Gradient Fill pixels do not match the clipboard artifact: ${JSON.stringify(pastedVersusClipboard)}`);
  }
  observations.push({
    label: 'gradient-rasterize-select-copy-paste',
    rasterizedType: rasterizedGradient.type,
    copiedBounds: copiedGradient.value.bounds,
    pastedType: pastedGradientLayer.type,
    nonTransparentCopiedPixels,
    copiedVersusSource,
    pastedVersusClipboard
  });
  await page.keyboard.press('Control+d');
  await driver.execute(documentId, 'adjustment.create', {
    kind: 'grade',
    placement: 'local',
    layerId: pastedGradientId
  });
  await assertAffordance('compact-pasted-raster-with-local-grade', pastedGradientId);
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});

  const beforeShadow = await capturePresentedPixels();
  await driver.resetRenderTelemetry(documentId);
  const shadowStartedAt = performance.now();
  await driver.execute(documentId, 'layer.effect.add', {
    layerId: sourceLayer.id,
    effectKind: 'drop-shadow'
  });
  const shadowCommandMs = performance.now() - shadowStartedAt;
  const shadowDocument = await driver.queryDocument(documentId);
  let shadowPixelDifference = 0;
  while (shadowPixelDifference <= 0 && performance.now() - shadowStartedAt < 2_000) {
    await page.waitForTimeout(16);
    shadowPixelDifference = (await comparePixels(beforeShadow, await capturePresentedPixels())).changedPixelRatio;
  }
  const shadowPresentationMs = performance.now() - shadowStartedAt;
  if (shadowPixelDifference <= 0) {
    throw new Error('Drop Shadow reached canonical state without changing the presented canvas.');
  }
  if (shadowPresentationMs > 750) {
    throw new Error(`Drop Shadow needed ${shadowPresentationMs.toFixed(1)} ms to become visible.`);
  }
  observations.push({
    label: 'drop-shadow-presentation',
    canonicalRevision: shadowDocument?.canonicalRevision,
    commandMs: shadowCommandMs,
    presentationMs: shadowPresentationMs,
    changedPixelRatio: shadowPixelDifference
  });
  await assertAffordance('raster-with-drop-shadow', sourceLayer.id);
  await driver.execute(documentId, 'layer.rasterize', { layerId: sourceLayer.id });
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});

  await driver.execute(documentId, 'adjustment.create', {
    kind: 'grade',
    placement: 'local',
    layerId: sourceLayer.id
  });
  await assertAffordance('raster-with-local-grade', sourceLayer.id);
  await driver.execute(documentId, 'layer.rasterize', { layerId: sourceLayer.id });
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});

  const attachedBlur = await driver.execute(documentId, 'adjustment.create', {
    kind: 'gaussian-blur',
    placement: 'attached',
    layerId: sourceLayer.id,
    settings: { radius: 8 }
  });
  if (attachedBlur.status !== 'completed') {
    throw new Error(`Attached Gaussian Blur was rejected: ${JSON.stringify(attachedBlur)}`);
  }
  await assertAffordance('raster-with-attached-gaussian-blur', sourceLayer.id);
  await driver.execute(documentId, 'layer.rasterize', { layerId: sourceLayer.id });
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});

  const duplicate = await driver.execute(documentId, 'layer.duplicate', {
    layerId: sourceLayer.id
  });
  const mergeBaseId = duplicate.value?.layerId;
  if (typeof mergeBaseId !== 'string') throw new Error('Duplicate returned no layer ID.');
  const blur = await driver.execute(documentId, 'adjustment.create', {
    kind: 'gaussian-blur',
    placement: 'adjustment-layer',
    aboveLayerId: mergeBaseId,
    settings: { radius: 8 }
  });
  const blurLayerId = blur.value?.layerId;
  if (typeof blurLayerId !== 'string') throw new Error('Gaussian Blur returned no layer ID.');

  const beforeMerge = await capturePresentedPixels();
  await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [sourceLayer.id],
    visible: false
  });
  const expectedAdjustedPixels = await capturePresentedPixels();
  await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [blurLayerId],
    visible: false
  });
  const baseOnlyPixels = await capturePresentedPixels();
  const adjustmentEffect = await comparePixels(expectedAdjustedPixels, baseOnlyPixels);
  if (adjustmentEffect.changedPixelRatio < 0.0001 || adjustmentEffect.rmse < 0.1) {
    throw new Error(`Gaussian Blur adjustment produced no meaningful isolated pixel change: ${JSON.stringify(adjustmentEffect)}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  const restoredBeforeMerge = await capturePresentedPixels();
  const visibilityUndo = await comparePixels(beforeMerge, restoredBeforeMerge);
  if (visibilityUndo.rmse > 2) {
    throw new Error(`Visibility setup did not undo back to the pre-merge image: ${JSON.stringify(visibilityUndo)}`);
  }

  await selectLayer(mergeBaseId);
  await page.locator(`[data-layer-id="${blurLayerId}"] .lighttable-layer__name`)
    .click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+e');
  try {
    await page.waitForFunction(({ documentId, mergeBaseId, blurLayerId }) => {
      const layers = window.__lightTableAutomation?.queryLayers(documentId) ?? [];
      return !layers.some(({ id }) => id === mergeBaseId || id === blurLayerId);
    }, { documentId, mergeBaseId, blurLayerId }, { timeout: 5_000 });
  } catch (reason) {
    const diagnostic = await page.evaluate((documentId) => ({
      activeLayerId: window.__lightTableAutomation?.queryDocument(documentId)?.activeLayerId,
      selectedRows: [...document.querySelectorAll('.lighttable-layer--selected')]
        .map((row) => row.getAttribute('data-layer-id')),
      activeElement: document.activeElement?.outerHTML,
      bodyTail: document.body.innerText.slice(-1_500)
    }), documentId);
    throw new Error(`Adjustment Merge Down shortcut did not complete: ${JSON.stringify(diagnostic)}`, {
      cause: reason
    });
  }
  const mergedLayers = await driver.queryLayers(documentId) ?? [];
  const mergedLayer = mergedLayers.find(({ id }) => id !== sourceLayer.id);
  if (mergedLayers.length !== initialLayers.length + 1
    || mergedLayer?.type !== 'raster') {
    throw new Error(`Adjustment Merge Down did not publish one raster replacement: ${JSON.stringify(mergedLayers)}`);
  }

  await driver.execute(documentId, 'layer.setVisibility', {
    layerIds: [sourceLayer.id],
    visible: false
  });
  const mergedIsolatedPixels = await capturePresentedPixels();
  const bakedAdjustment = await comparePixels(expectedAdjustedPixels, mergedIsolatedPixels);
  const mergedVersusBase = await comparePixels(baseOnlyPixels, mergedIsolatedPixels);
  await Promise.all([
    writeFile(path.join(outputDirectory, 'merge-expected-adjusted.png'), expectedAdjustedPixels),
    writeFile(path.join(outputDirectory, 'merge-base-only.png'), baseOnlyPixels),
    writeFile(path.join(outputDirectory, 'merge-actual-raster.png'), mergedIsolatedPixels)
  ]);
  if (bakedAdjustment.rmse > 2) {
    throw new Error(`Merged raster does not match the isolated adjusted source: ${JSON.stringify({
      bakedAdjustment,
      adjustmentEffect,
      mergedVersusBase
    })}`);
  }
  if (mergedVersusBase.changedPixelRatio < 0.0001 || mergedVersusBase.rmse < 0.1) {
    throw new Error(`Merged raster matches the unadjusted source; Gaussian Blur was not baked: ${JSON.stringify(mergedVersusBase)}`);
  }
  await driver.execute(documentId, 'history.undo', {});
  await driver.execute(documentId, 'history.undo', {});
  const restoredLayers = await driver.queryLayers(documentId) ?? [];
  const restoredBase = restoredLayers.find(({ id }) => id === mergeBaseId);
  const restoredAdjustment = restoredLayers.find(({ id }) => id === blurLayerId);
  if (restoredBase?.type !== 'raster' || restoredAdjustment?.type !== 'adjustment') {
    throw new Error(`Undo did not restore both semantic source layers: ${JSON.stringify(restoredLayers)}`);
  }
  const afterMergeUndo = await capturePresentedPixels();
  const mergeUndoPixels = await comparePixels(beforeMerge, afterMergeUndo);
  if (mergeUndoPixels.rmse > 2) {
    throw new Error(`Merge undo did not restore the pre-merge pixels: ${JSON.stringify(mergeUndoPixels)}`);
  }
  observations.push({
    label: 'adjustment-merge-down-with-external-lower-layer',
    merged: true,
    layerCount: mergedLayers.length,
    adjustmentEffect,
    bakedAdjustment,
    mergedVersusBase,
    mergeUndoPixels,
    restoredLayerTypes: [restoredBase.type, restoredAdjustment.type]
  });

  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    initial: initial.document,
    observations
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ reportPath, observations: observations.map((observation) => ({
    label: observation.label,
    ...('count' in observation ? { count: observation.count, visible: observation.visible } : {}),
    ...('presentationMs' in observation ? {
      commandMs: observation.commandMs,
      presentationMs: observation.presentationMs,
      changedPixelRatio: observation.changedPixelRatio
    } : {}),
    ...('merged' in observation ? { merged: observation.merged } : {})
  })) }, null, 2)}\n`);
} finally {
  await app.close();
}
