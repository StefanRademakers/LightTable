import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'adjustment-menu-smoke');
const reportPath = path.join(output, 'report.json');
const screenshotPath = path.join(output, 'adjustment-menu.png');
const levelsScreenshotPath = path.join(output, 'levels-properties.png');
const userData = path.join(output, `user-data-${process.pid}`);
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const pageErrors = [];
const consoleErrors = [];
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: { ...environment, LIGHTTABLE_AUTOMATION_USER_DATA: userData },
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 820, height: 620 });
  await waitForDesktopLauncher({
    app,
    page,
    outputDirectory: output,
    sourceFile: 'generated-adjustment-menu-document',
    pageErrors,
    label: 'adjustment-menu'
  });
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'attached', timeout: 60_000 });

  // Top-level flyouts have one visibility owner. A focused category must not
  // keep its old submenu open when pointer navigation selects a sibling.
  await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
  const filterMenu = page.getByRole('menu', { name: 'Context menu' });
  const expectedFilterFlyouts = {
    Blur: 'Gaussian Blur...',
    Distort: 'Displace...',
    Noise: 'Median...',
    Sharpen: 'Smart Sharpen...',
    Other: 'High Pass...'
  };
  for (const [category, expectedItem] of Object.entries(expectedFilterFlyouts)) {
    await filterMenu.getByRole('menuitem', { name: category, exact: true }).hover();
    const visibleFlyouts = page.locator('.context-menu--submenu:visible');
    const visibleFlyoutCount = await visibleFlyouts.count();
    if (visibleFlyoutCount !== 1) {
      const flyoutItems = await visibleFlyouts.evaluateAll((menus) => menus.map((menu) => ({
        parent: menu.parentElement?.querySelector(':scope > .context-menu__item')?.textContent?.trim(),
        parentClass: menu.parentElement?.className,
        items: [...menu.querySelectorAll(':scope > .context-menu__item-wrap > .context-menu__item .context-menu__item-label')]
          .map((label) => label.textContent?.trim())
      })));
      throw new Error(`${category} left ${visibleFlyoutCount} Filter flyouts visible: ${JSON.stringify(flyoutItems)}.`);
    }
    await visibleFlyouts.getByRole('menuitem', { name: expectedItem, exact: true })
      .waitFor({ state: 'visible' });
  }
  await page.keyboard.press('Escape');

  const layersPanel = page.locator('.lighttable-layers');
  if (await page.locator('.lighttable-global-processing-row').count()) {
    throw new Error('Legacy Global Grade or Global Lens FX pseudo rows are still visible.');
  }
  await page.getByRole('treeitem', { name: /Background/ }).click();
  await layersPanel.getByLabel('Layer blend mode').waitFor({ state: 'visible' });
  const transparencyLock = layersPanel.getByRole('button', { name: 'Lock transparent pixels' });
  await transparencyLock.hover();
  const hoverLockStyle = await transparencyLock.evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  await transparencyLock.click();
  await layersPanel.getByAltText('Layer has locked properties').waitFor({ state: 'visible' });
  const activeLockStyle = await transparencyLock.evaluate((button) => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, border: style.borderColor };
  });
  if (activeLockStyle.background !== hoverLockStyle.background
    || activeLockStyle.border !== hoverLockStyle.border) {
    throw new Error(`Active lock does not retain its hover style: ${JSON.stringify({ hoverLockStyle, activeLockStyle })}.`);
  }
  await transparencyLock.click();
  if (await layersPanel.getByAltText('Layer has locked properties').count()) {
    throw new Error('The layer-row lock summary remained after the final lock was cleared.');
  }

  const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'New fill or processing layer' });
  await menu.waitFor({ state: 'visible' });
  const bounds = await menu.boundingBox();
  if (!bounds) throw new Error('The adjustment menu has no visible bounds.');
  const viewport = page.viewportSize();
  if (!viewport || bounds.x < 0 || bounds.y < 0
    || bounds.x + bounds.width > viewport.width
    || bounds.y + bounds.height > viewport.height) {
    throw new Error(`The adjustment menu escaped the viewport: ${JSON.stringify(bounds)}.`);
  }
  const isPortal = await menu.evaluate((element) => (
    element.parentElement === document.body
    && !element.closest('.lighttable-layers-panel')
  ));
  if (!isPortal) throw new Error('The adjustment menu is still owned by the Layers panel DOM.');

  for (const label of ['Grade', 'Color and Vibrance', 'Curves', 'Exposure', 'Selective Color']) {
    await menu.getByRole('menuitem', { name: `New ${label}${[
      'Grade'
    ].includes(label) ? '' : ' adjustment'} layer`, exact: true })
      .waitFor({ state: 'attached' });
  }
  await menu.getByRole('menuitem', { name: 'New Lens Fx layer', exact: true })
    .waitFor({ state: 'attached' });
  if (await menu.getByRole('menuitem', { name: 'New Gradient Fill layer', exact: true }).count()) {
    throw new Error('Gradient Fill is still exposed in the processing-layer menu.');
  }
  if (await menu.getByRole('menuitem', { name: /^New Grain(?: adjustment)? layer$/ }).count()) {
    throw new Error('Lens FX Grain is still exposed as a standalone adjustment layer.');
  }
  const attachExposure = menu.getByRole('menuitem', {
    name: 'Attach Exposure to selected layer', exact: true
  });
  await attachExposure.waitFor({ state: 'visible' });
  await page.screenshot({ path: screenshotPath });
  await attachExposure.click();
  await page.locator('.lighttable-layer-effect--local-processing')
    .filter({ hasText: /^Exposure$/ })
    .waitFor({ state: 'visible' });
  await trigger.click();
  const reopenedMenu = page.getByRole('menu', { name: 'New fill or processing layer' });
  await reopenedMenu.getByRole('menuitem', {
    name: 'Attach Levels to selected layer', exact: true
  }).click();
  await page.locator('.lighttable-layer-effect--local-processing')
    .filter({ hasText: /^Levels$/ })
    .waitFor({ state: 'visible' });
  const levels = page.getByRole('complementary', { name: 'Levels properties' });
  await levels.waitFor({ state: 'visible' });
  await levels.getByLabel('RGB histogram').waitFor({ state: 'visible' });
  if (await levels.locator('input[type="range"]').count() !== 5) {
    throw new Error('Levels does not expose the expected five combined range handles.');
  }
  const blackInput = levels.getByRole('slider', { name: 'Black input', exact: true });
  const blackInputBounds = await blackInput.boundingBox();
  if (!blackInputBounds) throw new Error('The Levels black-input handle has no bounds.');
  const levelsY = blackInputBounds.y + blackInputBounds.height / 2;
  await page.mouse.move(blackInputBounds.x + 7, levelsY);
  await page.mouse.down();
  await page.mouse.move(blackInputBounds.x + blackInputBounds.width * 0.28, levelsY, { steps: 8 });
  const liveBlackInput = Number(await blackInput.inputValue());
  if (liveBlackInput < 40 || liveBlackInput > 100) {
    throw new Error(`Levels did not update continuously during drag: ${liveBlackInput}.`);
  }
  await page.mouse.up();
  const committedBlackInput = Number(await blackInput.inputValue());
  if (Math.abs(committedBlackInput - liveBlackInput) > 1) {
    throw new Error(`Levels changed after pointer-up: ${liveBlackInput} -> ${committedBlackInput}.`);
  }
  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Color and Vibrance adjustment layer', exact: true })
    .click();
  const colorVibrance = page.getByRole('complementary', { name: 'Color and Vibrance properties' });
  await colorVibrance.waitFor({ state: 'visible' });
  if (await colorVibrance.locator('input[type="range"]').count() !== 4) {
    throw new Error('Color and Vibrance does not expose its four coupled controls.');
  }

  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Curves adjustment layer', exact: true })
    .click();
  const curves = page.getByRole('complementary', { name: 'Curves properties' });
  await curves.waitFor({ state: 'visible' });
  const curveGraph = curves.getByRole('application', { name: 'master custom curve' });
  const curveBounds = await curveGraph.boundingBox();
  if (!curveBounds) throw new Error('The Curves graph has no bounds.');
  await page.mouse.move(
    curveBounds.x + curveBounds.width * 0.5,
    curveBounds.y + curveBounds.height * 0.5
  );
  await page.mouse.down();
  await page.mouse.move(
    curveBounds.x + curveBounds.width * 0.68,
    curveBounds.y + curveBounds.height * 0.28,
    { steps: 8 }
  );
  const liveCurvePoint = await curveGraph.locator('.lighttable-curves-editor__point').nth(1)
    .evaluate((element) => ({ cx: element.getAttribute('cx'), cy: element.getAttribute('cy') }));
  if (Number(liveCurvePoint.cx) < 150 || Number(liveCurvePoint.cy) > 100) {
    throw new Error(`Curves did not present its live point: ${JSON.stringify(liveCurvePoint)}.`);
  }
  await page.mouse.up();

  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Gradient Map adjustment layer', exact: true })
    .click();
  const gradientMap = page.getByRole('complementary', { name: 'Gradient Map properties' });
  await gradientMap.waitFor({ state: 'visible' });
  const addColorStop = gradientMap.getByRole('button', { name: 'Add color stop', exact: true });
  const addColorBounds = await addColorStop.boundingBox();
  if (!addColorBounds) throw new Error('The Gradient Map color-stop hit region has no bounds.');
  await page.mouse.click(
    addColorBounds.x + addColorBounds.width * 0.4,
    addColorBounds.y + addColorBounds.height / 2
  );
  const colorStops = gradientMap.locator('.lighttable-style-gradient__stop--color');
  if (await colorStops.count() !== 3) {
    throw new Error(`Gradient Map did not add its middle color stop: ${await colorStops.count()}.`);
  }
  const middleColorStop = colorStops.nth(1);
  await middleColorStop.waitFor({ state: 'visible' });
  const gradientTrack = gradientMap.locator('.lighttable-style-gradient__track');
  const gradientBounds = await gradientTrack.boundingBox();
  const stopBounds = await middleColorStop.boundingBox();
  if (!gradientBounds || !stopBounds) throw new Error('The Gradient Map controls have no bounds.');
  await page.mouse.move(stopBounds.x + stopBounds.width / 2, stopBounds.y + stopBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    gradientBounds.x + gradientBounds.width * 0.75,
    stopBounds.y + stopBounds.height / 2,
    { steps: 8 }
  );
  const liveStopLabel = await middleColorStop.getAttribute('aria-label');
  if (!liveStopLabel || !/Color stop (6\d|7\d|8\d)%/.test(liveStopLabel)) {
    throw new Error(`Gradient Map did not present its live stop: ${liveStopLabel}.`);
  }
  await page.mouse.up();

  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Grade layer', exact: true })
    .click();
  await page.getByRole('complementary', { name: 'Grade Layer properties' })
    .waitFor({ state: 'visible' });
  const queryActiveDocument = () => page.evaluate(() => {
    const driver = window.__lightTableAutomation;
    const documentId = driver?.queryWorkspace()?.activeDocumentId;
    return documentId ? {
      document: driver?.queryDocument(documentId),
      layers: driver?.queryLayers(documentId)
    } : null;
  });
  const gradeDocumentBeforeDrag = await queryActiveDocument();
  const colorGradingToggle = page.getByRole('button', { name: 'Color Grading', exact: true });
  await colorGradingToggle.scrollIntoViewIfNeeded();
  if (await colorGradingToggle.getAttribute('aria-expanded') !== 'true') {
    await colorGradingToggle.click();
  }
  const gradingWheel = page.getByRole('slider', { name: 'Midtones color tint', exact: true });
  await gradingWheel.scrollIntoViewIfNeeded();
  const floatingLayers = layersPanel.locator('xpath=ancestor::*[contains(@class,"dv-resize-container")]').first();
  const floatingLayersDisplay = await floatingLayers.evaluate((element) => element.style.display);
  await floatingLayers.evaluate((element) => { element.style.display = 'none'; });
  const wheelBounds = await gradingWheel.boundingBox();
  if (!wheelBounds) throw new Error('The Color Grading wheel has no bounds.');
  const wheelReceivesPointer = await gradingWheel.evaluate((wheel, bounds) => {
    const hit = document.elementFromPoint(
      bounds.x + bounds.width * 0.7,
      bounds.y + bounds.height * 0.5
    );
    return Boolean(hit && (hit === wheel || wheel.contains(hit)));
  }, wheelBounds);
  if (!wheelReceivesPointer) {
    throw new Error('The Color Grading wheel remains covered after isolating its panel.');
  }
  const gradingHandle = gradingWheel.locator('.lighttable-grading-wheel__handle');
  await page.mouse.move(
    wheelBounds.x + wheelBounds.width * 0.7,
    wheelBounds.y + wheelBounds.height * 0.5
  );
  await page.mouse.down();
  const gradeDocumentAfterPointerDown = await queryActiveDocument();
  await page.mouse.move(
    wheelBounds.x + wheelBounds.width * 0.65,
    wheelBounds.y + wheelBounds.height * 0.25,
    { steps: 8 }
  );
  const gradingDomAfterMove = await page.evaluate(() => ({
    wheelCount: document.querySelectorAll('[role="slider"][aria-label="Midtones color tint"]').length,
    handleCount: document.querySelectorAll('.lighttable-grading-wheel__handle').length,
    propertiesLabel: document.querySelector('.lighttable-grade-panel')?.getAttribute('aria-label') ?? null,
    colorGradingExpanded: document.querySelector(
      'button[aria-label="Color Grading"]'
    )?.getAttribute('aria-expanded') ?? null
  }));
  const gradeDocumentAfterMove = await queryActiveDocument();
  await page.screenshot({ path: path.join(output, 'color-grading-drag.png') });
  if (gradingDomAfterMove.wheelCount === 0 || gradingDomAfterMove.handleCount === 0) {
    throw new Error(`Color Grading controls disappeared during drag: ${JSON.stringify({
      gradingDomAfterMove,
      gradeDocumentBeforeDrag,
      gradeDocumentAfterPointerDown,
      gradeDocumentAfterMove
    })}.`);
  }
  const liveWheelPosition = await gradingHandle.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top
  }));
  if (liveWheelPosition.left === '50%' && liveWheelPosition.top === '50%') {
    throw new Error('The Color Grading wheel handle remained at its committed position during drag.');
  }
  await page.mouse.up();
  await floatingLayers.evaluate((element, display) => { element.style.display = display; }, floatingLayersDisplay);
  const activeSelectionStyles = await page.evaluate(() => {
    const tool = document.querySelector('.lighttable-toolbox__button--active');
    const layer = document.querySelector('.lighttable-layer--active');
    if (!tool || !layer) return null;
    const toolStyle = getComputedStyle(tool);
    const layerStyle = getComputedStyle(layer);
    return {
      tool: { background: toolStyle.backgroundColor, border: toolStyle.borderColor },
      layer: { background: layerStyle.backgroundColor, border: layerStyle.borderColor }
    };
  });
  if (!activeSelectionStyles
    || activeSelectionStyles.tool.background !== activeSelectionStyles.layer.background
    || activeSelectionStyles.tool.border !== activeSelectionStyles.layer.border) {
    throw new Error(`Active tool/layer styles diverge: ${JSON.stringify(activeSelectionStyles)}.`);
  }
  await page.getByRole('treeitem', { name: /Background/ }).click();
  await page.getByRole('complementary', { name: 'Local Grade properties' })
    .waitFor({ state: 'visible' });
  await page.screenshot({ path: levelsScreenshotPath });
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Renderer errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  await writeFile(reportPath, `${JSON.stringify({
    bounds,
    viewport,
    portalOwned: isPortal,
    attachedExposure: true,
    attachedLevels: true,
    levelsLiveDrag: { liveBlackInput, committedBlackInput },
    colorVibranceLayer: true,
    curvesLiveDrag: liveCurvePoint,
    gradientMapLiveDrag: liveStopLabel,
    colorGradingLiveDrag: liveWheelPosition,
    gradingDomAfterMove,
    activeSelectionStyles,
    filterFlyouts: Object.keys(expectedFilterFlyouts),
    pageErrors,
    consoleErrors
  }, null, 2)}\n`);
  process.stdout.write(`Adjustment menu smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close();
}
