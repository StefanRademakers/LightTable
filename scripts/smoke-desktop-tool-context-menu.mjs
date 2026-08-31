import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const executablePath = path.join(workspaceRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'tool-context-menu-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'shape-context-menu.png');
const geometryScreenshotPath = path.join(outputDirectory, 'shape-context-menu-geometry.png');
const lineStyleScreenshotPath = path.join(outputDirectory, 'shape-context-menu-line-style.png');
const colorPickerScreenshotPath = path.join(outputDirectory, 'shape-context-menu-color-picker.png');
const gradientEditorScreenshotPath = path.join(outputDirectory, 'shape-context-menu-gradient-editor.png');
const reportPath = path.join(outputDirectory, 'shape-context-menu.json');

await Promise.all([access(sourceFile), access(executablePath), mkdir(userDataPath, { recursive: true })]);
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [path.join(workspaceRoot, 'apps', 'desktop')],
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
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.keyboard.press('u');
  await page.keyboard.press('Shift+u');

  const viewport = page.locator('.lighttable-viewport');
  const viewportBounds = await viewport.boundingBox();
  if (!viewportBounds) throw new Error('Viewport bounds are unavailable.');
  const click = {
    x: viewportBounds.x + viewportBounds.width - 18,
    y: viewportBounds.y + viewportBounds.height - 18
  };
  await page.mouse.click(click.x, click.y, { button: 'right' });

  const layout = page.getByRole('dialog', { name: 'Tool settings' });
  await layout.waitFor({ state: 'visible' });
  const family = page.getByRole('toolbar', { name: 'Shape tools' });
  await family.waitFor({ state: 'visible' });
  for (const name of ['Rectangle (U)', 'Ellipse (U)', 'Triangle (U)', 'Line (U)']) {
    await family.getByRole('button', { name }).waitFor({ state: 'visible' });
  }

  const placement = await page.evaluate(() => {
    const layout = document.querySelector('.lighttable-tool-options-menu-layout');
    const family = document.querySelector('.lighttable-tool-options-menu__family');
    const properties = document.querySelector('.lighttable-tool-options-menu');
    if (!layout || !family || !properties) throw new Error('Context menu columns are unavailable.');
    const outer = layout.getBoundingClientRect();
    const familyBounds = family.getBoundingClientRect();
    const propertyBounds = properties.getBoundingClientRect();
    return {
      outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom },
      gap: propertyBounds.left - familyBounds.right,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  if (Math.abs(placement.gap - 8) > 0.1) {
    throw new Error(`Tool family/property gap is ${placement.gap}px instead of 8px.`);
  }
  if (placement.outer.left < 8 || placement.outer.top < 8
    || placement.outer.right > placement.viewport.width - 8
    || placement.outer.bottom > placement.viewport.height - 8) {
    throw new Error(`Context menu escaped the viewport: ${JSON.stringify(placement)}`);
  }

  await page.screenshot({ path: screenshotPath });
  await family.getByRole('button', { name: 'Rectangle (U)' }).click();
  await family.getByRole('button', { name: 'Rectangle (U)' })
    .waitFor({ state: 'visible' });
  const geometryTrigger = layout.getByRole('button', { name: 'Geometry', exact: true });
  await geometryTrigger.click();
  const geometryDropdown = page.getByRole('dialog', { name: 'Geometry options', exact: true });
  await geometryDropdown.waitFor({ state: 'visible' });
  await geometryDropdown.getByLabel('Shape application mode').waitFor({ state: 'visible' });
  await geometryDropdown.getByLabel('Shape geometry mode').waitFor({ state: 'visible' });
  for (const name of ['From center', 'Snap pixels', 'Link corners', 'Radius']) {
    await geometryDropdown.getByText(name, { exact: true }).waitFor({ state: 'visible' });
  }
  const geometryBounds = await geometryDropdown.boundingBox();
  if (!geometryBounds || geometryBounds.y < 8
    || geometryBounds.y + geometryBounds.height > placement.viewport.height - 8) {
    throw new Error(`Geometry dropdown escaped the viewport: ${JSON.stringify(geometryBounds)}`);
  }
  if (await layout.getByLabel('Shape geometry mode').count()
    || await layout.getByText('From center', { exact: true }).count()
    || await layout.getByText('Link corners', { exact: true }).count()) {
    throw new Error('Geometry controls are still duplicated directly in the property bar.');
  }
  await page.screenshot({ path: geometryScreenshotPath });
  await geometryDropdown.getByRole('button', { name: 'Close geometry' }).click();
  await geometryDropdown.waitFor({ state: 'detached' });
  await layout.getByLabel('Weight').waitFor({ state: 'visible' });
  await layout.getByRole('button', { name: 'Fill paint', exact: true }).click();
  const paintDropdown = page.getByRole('dialog', { name: 'Fill paint options', exact: true });
  await paintDropdown.waitFor({ state: 'visible' });
  const paintTypes = paintDropdown.getByRole('radiogroup', { name: 'Fill paint type' });
  await paintTypes.getByRole('radio', { name: 'Color' }).waitFor({ state: 'visible' });
  const paintFieldDimensions = [];
  const recordPaintField = async (type, selector) => {
    const field = layout.locator(selector).first();
    await field.waitFor({ state: 'visible' });
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error(`${type} paint field bounds are unavailable.`);
    paintFieldDimensions.push({ type, width: bounds.width, height: bounds.height });
  };
  await recordPaintField('color', '.color-swatch-field');
  await paintTypes.getByRole('radio', { name: 'None' }).click();
  await recordPaintField('none', '.none-paint-field');
  await paintTypes.getByRole('radio', { name: 'Gradient' }).click();
  const gradientEditor = paintDropdown.locator('.lighttable-style-gradient');
  await gradientEditor.waitFor({ state: 'visible' });
  if (await gradientEditor.getByText('Location', { exact: true }).count()
    || await gradientEditor.getByText('Midpoint', { exact: true }).count()) {
    throw new Error('Gradient location or midpoint sliders are still visible.');
  }
  const gradientPreview = gradientEditor.locator('.lighttable-style-gradient__preview');
  const previewBounds = await gradientPreview.boundingBox();
  if (!previewBounds) throw new Error('Gradient preview bounds are unavailable.');
  const colorMidpoint = gradientEditor.getByRole('button', { name: 'Color midpoint 50%' });
  const midpointBounds = await colorMidpoint.boundingBox();
  if (!midpointBounds) throw new Error('Gradient midpoint bounds are unavailable.');
  await page.mouse.move(midpointBounds.x + midpointBounds.width / 2,
    midpointBounds.y + midpointBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(previewBounds.x + previewBounds.width * 0.6,
    midpointBounds.y + midpointBounds.height / 2);
  await page.mouse.up();
  const movedMidpoint = gradientEditor.getByRole('button', { name: 'Color midpoint 60%' });
  await movedMidpoint.waitFor({ state: 'visible' });
  const firstColorStop = gradientEditor.getByRole('button', { name: 'Color stop 0%' });
  const firstStopBounds = await firstColorStop.boundingBox();
  if (!firstStopBounds) throw new Error('First color stop bounds are unavailable.');
  await page.mouse.move(firstStopBounds.x + firstStopBounds.width / 2,
    firstStopBounds.y + firstStopBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(previewBounds.x + previewBounds.width * 0.2,
    firstStopBounds.y + firstStopBounds.height / 2);
  await page.mouse.up();
  await gradientEditor.getByRole('button', { name: 'Color stop 20%' }).waitFor({ state: 'visible' });
  await movedMidpoint.waitFor({ state: 'visible' });
  const relativeMidpointBounds = await movedMidpoint.boundingBox();
  if (!relativeMidpointBounds) throw new Error('Moved midpoint bounds are unavailable.');
  const relativeMidpointPosition = (
    relativeMidpointBounds.x + relativeMidpointBounds.width / 2 - previewBounds.x
  ) / previewBounds.width;
  if (Math.abs(relativeMidpointPosition - 0.68) > 0.02) {
    throw new Error(`Midpoint lost its relative position: ${relativeMidpointPosition}`);
  }
  await page.screenshot({ path: gradientEditorScreenshotPath });
  await recordPaintField('gradient', '.gradient-field');
  await paintTypes.getByRole('radio', { name: 'Color' }).click();
  const picker = paintDropdown.locator('.ui-color-picker');
  await picker.waitFor({ state: 'visible' });
  if (paintFieldDimensions.some(({ width, height }) => width !== 72 || height !== 28)) {
    throw new Error(`Paint field states differ: ${JSON.stringify(paintFieldDimensions)}`);
  }
  const paintDropdownPlacement = await page.evaluate(() => {
    const popover = document.querySelector('[aria-label="Fill paint options"]');
    const surface = document.querySelector('.lighttable-tool-options-menu-layout');
    if (!popover || !surface) throw new Error('Paint dropdown surface is unavailable.');
    const bounds = popover.getBoundingClientRect();
    const surfaceBounds = surface.getBoundingClientRect();
    return {
      dropdown: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
      surface: {
        left: surfaceBounds.left, right: surfaceBounds.right,
        top: surfaceBounds.top, bottom: surfaceBounds.bottom
      },
      viewportHeight: window.innerHeight,
      zIndex: getComputedStyle(popover).zIndex
    };
  });
  const horizontalGap = Math.min(
    Math.abs(paintDropdownPlacement.dropdown.left - paintDropdownPlacement.surface.right),
    Math.abs(paintDropdownPlacement.surface.left - paintDropdownPlacement.dropdown.right)
  );
  if (horizontalGap > 12) {
    throw new Error(`Paint dropdown is detached from its context surface: ${JSON.stringify(paintDropdownPlacement)}`);
  }
  if (paintDropdownPlacement.dropdown.top < 8
    || paintDropdownPlacement.dropdown.bottom > paintDropdownPlacement.viewportHeight - 8
    || Number(paintDropdownPlacement.zIndex) <= 10020) {
    throw new Error(`Paint dropdown escaped the viewport: ${JSON.stringify(paintDropdownPlacement)}`);
  }
  const hue = picker.getByRole('slider', { name: 'Hue' });
  const hueBounds = await hue.boundingBox();
  if (!hueBounds) throw new Error('Color picker hue control is unavailable.');
  await page.mouse.click(hueBounds.x + hueBounds.width * 0.55, hueBounds.y + hueBounds.height / 2);
  await layout.waitFor({ state: 'visible' });
  await picker.waitFor({ state: 'visible' });
  await paintDropdown.getByRole('button', { name: 'Close fill paint' }).click();
  await paintDropdown.waitFor({ state: 'detached' });
  await layout.getByRole('button', { name: 'Line paint', exact: true }).click();
  const linePaintDropdown = page.getByRole('dialog', { name: 'Line paint options', exact: true });
  await linePaintDropdown.waitFor({ state: 'visible' });
  const lineOpacitySlider = linePaintDropdown.getByRole('slider', { name: 'Color opacity' });
  await lineOpacitySlider.waitFor({ state: 'visible' });
  if (await lineOpacitySlider.inputValue() !== '100') {
    throw new Error(`Unexpected initial line opacity: ${await lineOpacitySlider.inputValue()}`);
  }
  await lineOpacitySlider.focus();
  await lineOpacitySlider.press('Home');
  for (let step = 0; step < 42; step += 1) await lineOpacitySlider.press('ArrowRight');
  if (await lineOpacitySlider.inputValue() !== '42') {
    throw new Error(`Line opacity slider did not update: ${await lineOpacitySlider.inputValue()}`);
  }
  if (await linePaintDropdown.getByLabel('Color opacity percentage').count()) {
    throw new Error('Color opacity still has a duplicate percentage input.');
  }
  if (!await linePaintDropdown.getByText('42%', { exact: true }).count()) {
    throw new Error('Color opacity output did not follow its slider.');
  }
  if (await layout.getByText('Line opacity', { exact: true }).count()) {
    throw new Error('Line opacity is still duplicated in the property bar.');
  }
  await page.screenshot({ path: colorPickerScreenshotPath });
  await linePaintDropdown.getByRole('button', { name: 'Close line paint' }).click();
  await linePaintDropdown.waitFor({ state: 'detached' });
  const lineStyleTrigger = layout.getByRole('button', { name: 'Line Style', exact: true });
  await lineStyleTrigger.click();
  const lineStyleDropdown = page.getByRole('dialog', { name: 'Line style options', exact: true });
  await lineStyleDropdown.waitFor({ state: 'visible' });
  if (await lineStyleDropdown.getByLabel('Weight').count()) {
    throw new Error('Weight is still duplicated inside the Line Style dropdown.');
  }
  await lineStyleDropdown.getByLabel('Stroke style').waitFor({ state: 'visible' });
  await lineStyleDropdown.getByLabel('Stroke alignment').waitFor({ state: 'visible' });
  await lineStyleDropdown.getByLabel('Stroke cap').waitFor({ state: 'visible' });
  const strokeJoin = lineStyleDropdown.getByLabel('Stroke join');
  await strokeJoin.waitFor({ state: 'visible' });
  await lineStyleDropdown.getByLabel('Stroke style').selectOption('dashed');
  await strokeJoin.selectOption('miter');
  await lineStyleDropdown.getByLabel('Miter').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const dropdown = document.querySelector('[aria-label="Line style options"]');
    if (!dropdown) return false;
    const bounds = dropdown.getBoundingClientRect();
    return bounds.top >= 8 && bounds.bottom <= window.innerHeight - 8;
  });
  const lineStyleBounds = await lineStyleDropdown.boundingBox();
  if (!lineStyleBounds || lineStyleBounds.y < 8
    || lineStyleBounds.y + lineStyleBounds.height > placement.viewport.height - 8) {
    throw new Error(`Line Style dropdown escaped the viewport: ${JSON.stringify(lineStyleBounds)}`);
  }
  if (await layout.getByLabel('Stroke style').count()
    || await layout.getByLabel('Stroke alignment').count()
    || await layout.getByLabel('Stroke join').count()) {
    throw new Error('Line Style controls are still duplicated directly in the property bar.');
  }
  await page.screenshot({ path: lineStyleScreenshotPath });
  await lineStyleDropdown.getByRole('button', { name: 'Close line style' }).click();
  await lineStyleDropdown.waitFor({ state: 'detached' });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    click,
    placement,
    paintFieldDimensions,
    relativeMidpointPosition,
    paintDropdownPlacement,
    lineOpacity: 0.42,
    pageErrors,
    screenshotPath,
    geometryScreenshotPath,
    lineStyleScreenshotPath,
    colorPickerScreenshotPath,
    gradientEditorScreenshotPath
  }, null, 2)}\n`);
  process.stdout.write(`Tool context-menu smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
