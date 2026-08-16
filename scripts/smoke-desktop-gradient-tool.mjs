import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const launch = await resolveDesktopTestLaunch(workspaceRoot);
const outputDirectory = path.join(workspaceRoot, 'tmp', 'gradient-tool-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'gradient-tool.png');
const editorScreenshotPath = path.join(outputDirectory, 'gradient-editor.png');
const liveScreenshotPath = path.join(outputDirectory, 'gradient-tool-live.png');
const selectionToolScreenshotPath = path.join(outputDirectory, 'gradient-tool-selection-tool.png');
const editedScreenshotPath = path.join(outputDirectory, 'gradient-tool-edited.png');
const outsideScreenshotPath = path.join(outputDirectory, 'gradient-tool-outside.png');
const pixelScreenshotPath = path.join(outputDirectory, 'gradient-tool-pixels.png');
const reportPath = path.join(outputDirectory, 'gradient-tool.json');

await Promise.all([access(sourceFile), mkdir(userDataPath, { recursive: true })]);
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
    sourceFile, pageErrors, label: 'gradient-tool' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const driver = await attachLightTableAutomation(page, 'gradient-tool-smoke');
  const documentId = (await driver.queryWorkspace())?.activeDocumentId;
  if (!documentId) throw new Error('No active document.');
  const before = await driver.queryDocument(documentId);
  if (!before) throw new Error('Document projection is unavailable.');
  const historyCheckpoints = [];
  const captureHistory = async (label) => {
    historyCheckpoints.push({ label, history: (await driver.queryDocument(documentId))?.history ?? null });
  };
  const layerListOverflow = await page.locator('.lighttable-layers__list').evaluate((element) => {
    element.style.maxHeight = '72px';
    return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  });
  if (layerListOverflow.scrollHeight <= layerListOverflow.clientHeight) {
    throw new Error(`A scaled layer list did not become scrollable: ${JSON.stringify(layerListOverflow)}`);
  }
  const layersPanel = page.locator('.lighttable-layers-panel');
  await layersPanel.evaluate((element) => {
    element.style.width = '190px';
  });
  const thumbnailBoxes = await page.locator('.lighttable-layer__thumbnail').evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const row = element.closest('.lighttable-layer')?.getBoundingClientRect();
      const panel = element.closest('.lighttable-layers-panel')?.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        containedInRow: Boolean(row)
          && bounds.left >= row.left - 0.5
          && bounds.right <= row.right + 0.5
          && bounds.top >= row.top - 0.5
          && bounds.bottom <= row.bottom + 0.5,
        containedInPanel: Boolean(panel)
          && bounds.left >= panel.left - 0.5
          && bounds.right <= panel.right + 0.5
      };
    })
  );
  if (!before.canvas) throw new Error('Document canvas projection is unavailable.');
  const expectedThumbnailHeight = Math.round(40 * before.canvas.height / before.canvas.width);
  if (!thumbnailBoxes.length || thumbnailBoxes.some(({ width, height }) => (
    Math.abs(width - 40) > 1 || Math.abs(height - expectedThumbnailHeight) > 1
  ))) {
    throw new Error(`Layer thumbnails do not fit the document aspect: ${JSON.stringify({
      document: before.canvas,
      thumbnailBoxes
    })}`);
  }
  if (thumbnailBoxes.some(({ containedInRow, containedInPanel }) => (
    !containedInRow || !containedInPanel
  ))) {
    throw new Error(`A thumbnail escaped its layer row: ${JSON.stringify(thumbnailBoxes)}`);
  }

  const gradientButton = page.getByRole('button', { name: 'Gradient (G)', exact: true });
  await page.keyboard.press('g');
  if (!await gradientButton.isVisible()) await page.keyboard.press('Shift+g');
  await gradientButton.waitFor({ state: 'visible' });
  await captureHistory('tool-activated');
  const viewport = page.locator('.lighttable-viewport');
  const addPointCursor = await viewport.evaluate((element) => getComputedStyle(element).cursor);
  if (!addPointCursor.includes('url(')) {
    throw new Error(`Gradient Tool is missing its add-point cursor: ${addPointCursor}`);
  }
  const iconSource = await gradientButton.locator('img').getAttribute('src');
  await page.keyboard.press('Shift+g');
  const bucketIconSource = await page.getByRole('button', { name: 'Paint bucket (G)', exact: true })
    .locator('img').getAttribute('src');
  await page.keyboard.press('Shift+g');
  await gradientButton.waitFor({ state: 'visible' });
  if (!iconSource || iconSource === bucketIconSource) {
    throw new Error('Gradient and Paint Bucket still use the same icon.');
  }
  await page.locator('.lighttable-tool-options__identity').click();
  await page.getByRole('combobox', { name: 'Gradient type' }).selectOption('radial');
  await page.getByRole('combobox', { name: 'Gradient type' }).selectOption('linear');
  await captureHistory('options-changed');
  await page.getByRole('button', { name: 'Edit gradient' }).click();
  const editor = page.getByRole('dialog', { name: 'Gradient editor' });
  await editor.waitFor({ state: 'visible' });
  await page.screenshot({ path: editorScreenshotPath });
  const ramp = editor.locator('.lighttable-style-gradient__preview');
  const colorStops = editor.locator('.lighttable-style-gradient__stop--color');
  const opacityStops = editor.locator('.lighttable-style-gradient__stop--opacity');
  const colorHitRegion = editor.getByRole('button', { name: 'Add color stop' });
  const opacityHitRegion = editor.getByRole('button', { name: 'Add opacity stop' });
  if (await colorStops.count() !== 2) throw new Error('The default gradient needs two color stops.');
  const rampCursor = await ramp.evaluate((element) => getComputedStyle(element).cursor);
  const colorHitCursor = await colorHitRegion.evaluate((element) => getComputedStyle(element).cursor);
  const opacityHitCursor = await opacityHitRegion.evaluate((element) => getComputedStyle(element).cursor);
  const stopCursor = await colorStops.first()
    .evaluate((element) => getComputedStyle(element).cursor);
  await page.keyboard.down('Control');
  await editor.locator('.lighttable-style-gradient--remove-stop').waitFor({ state: 'visible' });
  const removePointCursor = await colorStops.first()
    .evaluate((element) => getComputedStyle(element).cursor);
  await page.keyboard.up('Control');
  if (rampCursor !== 'default' || colorHitCursor !== addPointCursor
    || opacityHitCursor !== addPointCursor || stopCursor !== 'grab'
    || removePointCursor === addPointCursor
    || !removePointCursor.includes('url(')) {
    throw new Error(`Gradient editor cursors are missing: ${JSON.stringify({
      rampCursor, colorHitCursor, opacityHitCursor, stopCursor, removePointCursor
    })}`);
  }
  const rampBounds = await ramp.boundingBox();
  if (!rampBounds) throw new Error('The gradient ramp is unavailable.');
  const colorHitBounds = await colorHitRegion.boundingBox();
  if (!colorHitBounds) throw new Error('The color-stop hit region is unavailable.');
  await page.mouse.click(colorHitBounds.x + colorHitBounds.width * 0.68,
    colorHitBounds.y + colorHitBounds.height / 2);
  if (await colorStops.count() !== 3) throw new Error('The lower hit region did not add a color stop.');
  await colorHitRegion.hover();
  await editor.getByText('Click below the gradient to add a color stop.', { exact: true })
    .waitFor({ state: 'visible' });
  const opacityHitBounds = await opacityHitRegion.boundingBox();
  if (!opacityHitBounds) throw new Error('The opacity-stop hit region is unavailable.');
  await page.mouse.click(opacityHitBounds.x + opacityHitBounds.width * 0.62,
    opacityHitBounds.y + opacityHitBounds.height / 2);
  if (await opacityStops.count() !== 3) throw new Error('The upper hit region did not add an opacity stop.');
  const addedOpacityStop = editor.locator(
    '.lighttable-style-gradient__stop--opacity.lighttable-style-gradient__stop--active'
  );
  await addedOpacityStop.click({ button: 'right' });
  if (await opacityStops.count() !== 2) throw new Error('Right-click did not remove the opacity stop.');
  const addedStop = editor.locator('.lighttable-style-gradient__stop--color.lighttable-style-gradient__stop--active');
  const addedBounds = await addedStop.boundingBox();
  if (!addedBounds) throw new Error('The added gradient stop is unavailable.');
  await page.mouse.move(addedBounds.x + addedBounds.width / 2, addedBounds.y + addedBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(rampBounds.x + rampBounds.width * 0.35, addedBounds.y + addedBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  const draggedStopLabel = await addedStop.getAttribute('aria-label');
  const draggedStopPercent = Number(/(\d+)%/.exec(draggedStopLabel ?? '')?.[1]);
  if (!Number.isFinite(draggedStopPercent) || Math.abs(draggedStopPercent - 35) > 1) {
    throw new Error(`Dragging did not update the gradient-stop location: ${draggedStopLabel}.`);
  }
  await addedStop.click({ button: 'right' });
  if (await colorStops.count() !== 2) throw new Error('Right-click did not remove the gradient stop.');
  await page.getByRole('button', { name: 'Close gradient' }).click();
  await captureHistory('gradient-editor-closed');

  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport bounds are unavailable.');
  await page.keyboard.down('Alt');
  await page.waitForFunction(() => document.querySelector('.lighttable-viewport')
    ?.classList.contains('lighttable-viewport--eyedropper'));
  await page.mouse.click(bounds.x + bounds.width * 0.85, bounds.y + bounds.height * 0.18);
  await page.keyboard.up('Alt');
  await captureHistory('color-sampled');

  const start = { x: bounds.x + bounds.width * 0.14, y: bounds.y + bounds.height * 0.20 };
  const end = { x: bounds.x + bounds.width * 0.37, y: bounds.y + bounds.height * 0.42 };
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const liveEnd = {
    x: start.x + (end.x - start.x) * 0.6,
    y: start.y + (end.y - start.y) * 0.6
  };
  await page.mouse.move(liveEnd.x, liveEnd.y, { steps: 3 });
  await page.waitForTimeout(50);
  const live = await driver.queryDocument(documentId);
  if (!live || live.layerCount !== before.layerCount + 1
    || live.history.undoDepth !== before.history.undoDepth) {
    throw new Error(`The live gradient preview was not published before pointer-up: ${JSON.stringify({
      before,
      live
    })}`);
  }
  await page.screenshot({ path: liveScreenshotPath });
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await captureHistory('gradient-dragged');
  await page.screenshot({ path: screenshotPath });

  // Vector selection remains semantic state, but its path/frame/gizmo chrome
  // must not leak into unrelated raster-selection tools.
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Rectangular selection (M)', exact: true })
    .waitFor({ state: 'visible' });
  await page.waitForTimeout(50);
  await page.screenshot({ path: selectionToolScreenshotPath });
  await page.keyboard.press('g');
  await gradientButton.waitFor({ state: 'visible' });

  const dragDx = end.x - start.x;
  const dragDy = end.y - start.y;
  const dragLength = Math.hypot(dragDx, dragDy);
  const snappedAngle = Math.round(Math.atan2(dragDy, dragDx) / (Math.PI / 4)) * (Math.PI / 4);
  const displayedEnd = {
    x: start.x + Math.cos(snappedAngle) * dragLength,
    y: start.y + Math.sin(snappedAngle) * dragLength
  };
  await page.mouse.click(displayedEnd.x, displayedEnd.y);
  const endpointEditor = page.getByRole('dialog', { name: 'Gradient editor' });
  await endpointEditor.waitFor({ state: 'visible' });
  if (await viewport.evaluate((element) => getComputedStyle(element).cursor) !== addPointCursor) {
    throw new Error('The Gradient tool lost its precise add-point cursor.');
  }
  await page.getByRole('button', { name: 'Close gradient' }).click();

  const after = await driver.queryDocument(documentId);
  const layers = await driver.queryLayers(documentId) ?? [];
  const activeLayer = layers.find(({ id }) => id === after?.activeLayerId);
  if (!after || after.layerCount !== before.layerCount + 1
    || after.history.undoDepth !== before.history.undoDepth + 1
    || activeLayer?.type !== 'vector') {
    throw new Error(`Gradient drag did not commit one editable vector layer: ${JSON.stringify({
      before,
      after,
      activeLayer,
      historyCheckpoints,
      pageErrors,
      body: await page.locator('body').innerText()
    })}`);
  }

  const layerBlendMode = page.getByRole('combobox', { name: 'Layer blend mode' });
  if (await layerBlendMode.isDisabled()) {
    throw new Error('The active Gradient Fill does not expose its layer blend mode.');
  }
  await layerBlendMode.selectOption('multiply');
  const blendedLayers = await driver.queryLayers(documentId) ?? [];
  const blendedGradient = blendedLayers.find(({ id }) => id === after.activeLayerId);
  if (blendedGradient?.blendMode !== 'multiply') {
    throw new Error(`The Gradient Fill blend mode did not update: ${JSON.stringify(blendedGradient)}`);
  }
  const layerFillOpacity = page.locator(
    '.lighttable-layers__opacity-controls .lighttable-adjustment input[type="range"]'
  ).nth(1);
  if (await layerFillOpacity.isDisabled()) {
    throw new Error('The active Gradient Fill does not expose its layer fill opacity.');
  }
  const activeLayerRow = page.locator('.lighttable-layer--active');
  await activeLayerRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create Clipping Mask' }).click();
  const clippedLayers = await driver.queryLayers(documentId) ?? [];
  const clippedGradient = clippedLayers.find(({ id }) => id === after.activeLayerId);
  if (!clippedGradient?.clipping) {
    throw new Error(`The Gradient Fill clipping mask did not update: ${JSON.stringify(clippedGradient)}`);
  }
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const compositingUndone = await driver.queryLayers(documentId) ?? [];
  const restoredGradient = compositingUndone.find(({ id }) => id === after.activeLayerId);
  if (restoredGradient?.blendMode !== 'normal'
    || restoredGradient.fillOpacity !== 1
    || restoredGradient.clipping) {
    throw new Error(`Gradient Fill compositing did not undo cleanly: ${JSON.stringify(restoredGradient)}`);
  }

  await page.getByRole('combobox', { name: 'Gradient type' }).selectOption('radial');
  await captureHistory('active-gradient-type-changed');
  const typeChanged = await driver.queryDocument(documentId);
  if (!typeChanged
    || typeChanged.layerCount !== after.layerCount
    || typeChanged.activeLayerId !== after.activeLayerId
    || typeChanged.history.undoDepth !== after.history.undoDepth + 1) {
    throw new Error(`Changing Gradient Type did not update the active fill layer: ${JSON.stringify({
      after,
      typeChanged,
      historyCheckpoints
    })}`);
  }

  const editStart = { x: bounds.x + bounds.width * 0.24, y: bounds.y + bounds.height * 0.30 };
  const editEnd = { x: bounds.x + bounds.width * 0.62, y: bounds.y + bounds.height * 0.30 };
  await page.mouse.move(editStart.x, editStart.y);
  await page.mouse.down();
  await page.mouse.move(editEnd.x, editEnd.y, { steps: 6 });
  await page.mouse.up();
  await captureHistory('active-gradient-edited');
  await page.screenshot({ path: editedScreenshotPath });
  const edited = await driver.queryDocument(documentId);
  if (!edited
    || edited.layerCount !== typeChanged.layerCount
    || edited.activeLayerId !== typeChanged.activeLayerId
    || edited.history.undoDepth !== typeChanged.history.undoDepth + 1) {
    throw new Error(`A second Gradient-tool drag did not edit the active fill in place: ${JSON.stringify({
      after,
      edited,
      historyCheckpoints
    })}`);
  }

  await page.keyboard.press('Shift+g');
  await page.getByRole('button', { name: 'Paint bucket (G)', exact: true }).waitFor({ state: 'visible' });
  await page.keyboard.press('Shift+g');
  await gradientButton.waitFor({ state: 'visible' });
  await page.keyboard.press('Control+z');
  const editUndone = await driver.queryDocument(documentId);
  if (!editUndone || editUndone.layerCount !== typeChanged.layerCount) {
    throw new Error('Ctrl+Z did not undo the in-place gradient edit first.');
  }
  await page.keyboard.press('Control+z');
  const typeUndone = await driver.queryDocument(documentId);
  if (!typeUndone || typeUndone.layerCount !== after.layerCount) {
    throw new Error('Ctrl+Z did not undo the Gradient Type change second.');
  }
  await page.keyboard.press('Control+z');
  const undone = await driver.queryDocument(documentId);
  if (!undone || undone.layerCount !== before.layerCount) {
    throw new Error('Ctrl+Z did not remove the Gradient Fill layer.');
  }

  const zoomLabel = await page.locator('.lighttable-toolbar__meta').innerText();
  const zoomPercent = Number(/(\d+(?:\.\d+)?)%\s*·\s*(?:RGB|CMYK|Gray)/.exec(zoomLabel)?.[1]);
  if (!Number.isFinite(zoomPercent) || !before.canvas) {
    throw new Error(`Could not resolve fitted canvas geometry: ${zoomLabel}`);
  }
  const scale = zoomPercent / 100;
  const imageTop = bounds.y + (bounds.height - before.canvas.height * scale) / 2;
  const outsideStart = { x: bounds.x + bounds.width * 0.35, y: imageTop + 100 };
  const outsideEnd = { x: outsideStart.x + 180, y: imageTop - 24 };
  await page.mouse.move(outsideStart.x, outsideStart.y);
  await page.mouse.down();
  await page.mouse.move(outsideEnd.x, outsideEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.screenshot({ path: outsideScreenshotPath });
  const createdOutside = await driver.queryDocument(documentId);
  if (!createdOutside || createdOutside.layerCount !== before.layerCount + 1) {
    throw new Error('A Gradient Fill with a pasteboard endpoint was not created.');
  }
  await page.mouse.move(outsideEnd.x, outsideEnd.y);
  await page.mouse.down();
  await page.mouse.move(outsideEnd.x, imageTop + 60, { steps: 6 });
  await page.mouse.up();
  const movedFromOutside = await driver.queryDocument(documentId);
  if (!movedFromOutside
    || movedFromOutside.layerCount !== createdOutside.layerCount
    || movedFromOutside.history.undoDepth !== createdOutside.history.undoDepth + 1) {
    throw new Error('The pasteboard endpoint could not be picked up and moved back over the canvas.');
  }
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  const backgroundLayer = page.locator('.lighttable-layer').filter({
    has: page.locator('.lighttable-layer__name[value="Background"]')
  }).first();
  await backgroundLayer.click();
  await page.getByRole('combobox', { name: 'Gradient application' }).selectOption('pixels');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.screenshot({ path: pixelScreenshotPath });
  const pixelFilled = await driver.queryDocument(documentId);
  if (!pixelFilled
    || pixelFilled.layerCount !== before.layerCount
    || pixelFilled.history.undoDepth !== before.history.undoDepth + 1) {
    throw new Error(`Pixel-gradient drag did not create one reversible raster edit: ${JSON.stringify({
      before,
      pixelFilled,
      body: await page.locator('body').innerText()
    })}`);
  }
  await page.keyboard.press('Control+z');
  const pixelUndone = await driver.queryDocument(documentId);
  if (!pixelUndone || pixelUndone.history.undoDepth !== before.history.undoDepth) {
    throw new Error('Ctrl+Z did not undo the pixel gradient.');
  }
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);

  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    iconSource,
    bucketIconSource,
    addPointCursor,
    rampCursor,
    colorHitCursor,
    opacityHitCursor,
    stopCursor,
    removePointCursor,
    thumbnailBoxes,
    createdLayerId: activeLayer.id,
    screenshotPath,
    editorScreenshotPath,
    liveScreenshotPath,
    selectionToolScreenshotPath,
    editedScreenshotPath,
    outsideScreenshotPath,
    pixelScreenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Gradient Tool smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
