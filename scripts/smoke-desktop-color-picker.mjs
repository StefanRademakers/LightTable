import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\shapes.psd');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'color-picker-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'production-color-picker.png');
const reportPath = path.join(outputDirectory, 'color-picker.json');

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

const normalizedColor = (value) => value.replace(/\s+/g, '').toLowerCase();
const rectanglesOverlap = (left, right) => !(
  left.x + left.width <= right.x || right.x + right.width <= left.x
  || left.y + left.height <= right.y || right.y + right.height <= left.y
);

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const openFile = await waitForDesktopLauncher({ app, page, outputDirectory,
    sourceFile, pageErrors, label: 'color-picker' });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const foreground = page.getByRole('button', { name: 'Foreground color', exact: true });
  await foreground.click();
  const picker = page.getByRole('dialog', { name: 'Color picker' });
  await picker.waitFor({ state: 'visible' });
  const triggerBounds = await foreground.boundingBox();
  const pickerBounds = await picker.boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  if (!triggerBounds || !pickerBounds || !viewport) throw new Error('Color picker geometry is unavailable.');
  if (pickerBounds.x < 0 || pickerBounds.y < 0
    || pickerBounds.x + pickerBounds.width > viewport.width
    || pickerBounds.y + pickerBounds.height > viewport.height) {
    throw new Error(`The color picker escaped the viewport: ${JSON.stringify({ pickerBounds, viewport })}`);
  }
  if (rectanglesOverlap(triggerBounds, pickerBounds)) {
    throw new Error(`The color picker covered its trigger despite available space: ${JSON.stringify({ triggerBounds, pickerBounds })}`);
  }

  const originalForeground = normalizedColor(await foreground.evaluate((element) => element.style.backgroundColor));
  const hex = picker.getByRole('textbox', { name: 'Hex color' });
  await hex.fill('#12ab34');
  const changedForeground = normalizedColor(await foreground.evaluate((element) => element.style.backgroundColor));
  if (changedForeground === originalForeground) throw new Error('Manual color input did not update the production foreground swatch.');
  await page.keyboard.press('Escape');
  const cancelledForeground = normalizedColor(await foreground.evaluate((element) => element.style.backgroundColor));
  if (cancelledForeground !== originalForeground) {
    throw new Error(`Escape did not restore the foreground color: ${originalForeground} -> ${cancelledForeground}`);
  }

  await foreground.click();
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#3456ab');
  await page.locator('.lighttable-tool-options__identity').click();
  await picker.waitFor({ state: 'hidden' });
  const committedForeground = normalizedColor(await foreground.evaluate((element) => element.style.backgroundColor));
  if (committedForeground === originalForeground) throw new Error('Outside-click did not commit the foreground color.');

  await page.keyboard.press('g');
  await page.getByRole('button', { name: 'Edit gradient' }).click();
  const gradientEditor = page.getByRole('dialog', { name: 'Gradient editor' });
  await gradientEditor.waitFor({ state: 'visible' });
  const gradientColor = gradientEditor.getByRole('button', { name: 'Color', exact: true });
  const beforeGradient = normalizedColor(await gradientColor.evaluate((element) => element.style.backgroundColor));
  await gradientColor.click();
  await picker.waitFor({ state: 'visible' });
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#00cc66');
  await gradientEditor.getByText('Color stops', { exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  const committedGradient = normalizedColor(await gradientColor.evaluate((element) => element.style.backgroundColor));
  if (committedGradient === beforeGradient) throw new Error('The gradient-stop swatch did not commit a custom color.');

  await gradientColor.click();
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#ff00ff');
  await page.keyboard.press('Escape');
  const cancelledGradient = normalizedColor(await gradientColor.evaluate((element) => element.style.backgroundColor));
  if (cancelledGradient !== committedGradient) {
    throw new Error(`Escape did not restore the gradient-stop color: ${committedGradient} -> ${cancelledGradient}`);
  }

  await gradientColor.click();
  await picker.waitFor({ state: 'visible' });
  const gradientTriggerBounds = await gradientColor.boundingBox();
  const gradientPickerBounds = await picker.boundingBox();
  if (!gradientTriggerBounds || !gradientPickerBounds) throw new Error('Gradient color picker geometry is unavailable.');
  if (gradientPickerBounds.x < 0 || gradientPickerBounds.y < 0
    || gradientPickerBounds.x + gradientPickerBounds.width > viewport.width
    || gradientPickerBounds.y + gradientPickerBounds.height > viewport.height) {
    throw new Error(`The gradient color picker escaped the viewport: ${JSON.stringify({ gradientPickerBounds, viewport })}`);
  }
  if (rectanglesOverlap(gradientTriggerBounds, gradientPickerBounds)) {
    throw new Error(`The gradient color picker covered its trigger despite available space: ${JSON.stringify({ gradientTriggerBounds, gradientPickerBounds })}`);
  }
  await page.screenshot({ path: screenshotPath });
  if (pageErrors.length) throw new Error(`Page errors: ${JSON.stringify(pageErrors)}`);
  await writeFile(reportPath, `${JSON.stringify({
    sourceFile,
    originalForeground,
    committedForeground,
    beforeGradient,
    committedGradient,
    triggerBounds,
    pickerBounds,
    gradientTriggerBounds,
    gradientPickerBounds,
    screenshotPath,
    pageErrors
  }, null, 2)}\n`);
  process.stdout.write(`Production color picker smoke passed. Report: ${reportPath}\n`);
} finally {
  await app.close().catch(() => {});
}
