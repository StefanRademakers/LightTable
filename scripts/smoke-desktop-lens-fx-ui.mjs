import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'lens-fx-ui-smoke');
const userData = path.join(output, `user-data-${process.pid}`);
const sourcePath = process.argv[2] ?? 'D:\\face.jpg';
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const difference = async (left, right) => {
  const [a, b] = await Promise.all([
    sharp(left).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    throw new Error('Lens FX comparison dimensions differ.');
  }
  let squared = 0;
  for (let index = 0; index < a.data.length; index += 1) {
    const delta = (a.data[index] - b.data[index]) / 255;
    squared += delta * delta;
  }
  return Math.sqrt(squared / a.data.length);
};

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const driver = await attachLightTableAutomation(page, 'lens-fx-ui-smoke');
  const artifact = await driver.registerInputArtifact(
    await readFile(sourcePath), path.basename(sourcePath), 'image/jpeg'
  );
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: artifact.id });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Opening the Lens FX source returned no document.');
  await driver.waitForDocument(documentId, 120_000);
  await driver.waitForLayers(documentId, 120_000);

  const exportPng = async (name) => {
    const accepted = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, accepted.taskId, 120_000);
    if (!task.artifact) throw new Error(`Export ${name} produced no artifact.`);
    const png = await driver.readArtifact(task.artifact.id);
    const target = path.join(output, `${name}.png`);
    await writeFile(target, png.bytes);
    return target;
  };

  const neutral = await exportPng('neutral');
  await page.getByRole('button', { name: 'New fill or processing layer' }).click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Lens Fx layer', exact: true })
    .click();
  await page.getByRole('treeitem', { name: /Lens Fx/ }).waitFor();
  await page.getByRole('switch', { name: 'Enable Lens Distortion' }).waitFor();

  const metrics = {};
  const bypassMetrics = {};
  const interactionTelemetry = {};
  const exercise = async (effect, sliderLabel, key = 'End', prepare) => {
    const enable = page.getByRole('switch', { name: `Enable ${effect}` });
    const section = page.getByRole('button', { name: `Reset ${effect}` })
      .locator('xpath=ancestor::section[1]');
    await enable.click();
    await prepare?.(section);
    await driver.resetRenderTelemetry(documentId);
    const slider = section.getByLabel(sliderLabel, { exact: true });
    await slider.focus();
    await slider.press(key);
    await page.waitForTimeout(2_000);
    if (effect === 'Lens Distortion') {
      const bounds = await slider.boundingBox();
      if (!bounds) throw new Error('Lens Distortion slider has no interactive bounds.');
      await driver.resetRenderTelemetry(documentId);
      await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      const dragValues = [];
      const dragTelemetry = [];
      for (let step = 0; step <= 45; step += 1) {
        await page.mouse.move(
          bounds.x + 2 + (bounds.width - 4) * (step / 45),
          bounds.y + bounds.height / 2
        );
        if (step === 15 || step === 30 || step === 45) {
          dragValues.push(Number(await slider.inputValue()));
          dragTelemetry.push(await driver.queryRenderTelemetry(documentId));
        }
        await page.waitForTimeout(1000 / 60);
      }
      await page.mouse.up();
      await page.waitForTimeout(500);
      if (!(dragValues[0] < dragValues[1] && dragValues[1] < dragValues[2])) {
        throw new Error(`Lens Distortion slider did not update continuously while dragging: ${dragValues.join(', ')}`);
      }
      const correctionFrames = dragTelemetry.map((snapshot) =>
        snapshot?.stages?.['source-geometry']?.executions ?? 0
      );
      if (!(correctionFrames[0] < correctionFrames[1]
        && correctionFrames[1] < correctionFrames[2])) {
        throw new Error(`Lens Distortion did not submit continuous GPU previews: ${correctionFrames.join(', ')}`);
      }
      interactionTelemetry['Lens Distortion drag samples'] = {
        values: dragValues,
        sourceGeometryFrames: correctionFrames
      };
    }
    interactionTelemetry[effect] = await driver.queryRenderTelemetry(documentId);
    if ((interactionTelemetry[effect]?.processingSuffixCache?.hits ?? 0) < 1) {
      throw new Error(`${effect} did not reuse the lower composite through the topmost processing suffix cache.`);
    }
    const rendered = await exportPng(effect.toLowerCase().replaceAll(' ', '-'));
    metrics[effect] = await difference(neutral, rendered);
    await page.getByRole('switch', { name: `Disable ${effect}` }).click();
    const bypassed = await exportPng(`${effect.toLowerCase().replaceAll(' ', '-')}-disabled`);
    bypassMetrics[effect] = await difference(neutral, bypassed);
  };

  await exercise('Lens Distortion', 'Distortion');
  await exercise('Chromatic Aberration', 'Amount');
  await exercise('Halation', 'Amount', 'End', async (section) => {
    const threshold = section.getByLabel('Threshold', { exact: true });
    await threshold.focus();
    await threshold.press('Home');
  });
  await exercise('Post-crop Vignette', 'Amount', 'Home');
  await exercise('Grain', 'Amount');

  const lensBlurEnable = page.getByRole('switch', { name: 'Enable Lens Blur' });
  const lensBlurSection = page.getByRole('button', { name: 'Reset Lens Blur' })
    .locator('xpath=ancestor::section[1]');
  await lensBlurEnable.click();
  await page.waitForFunction(() => {
    const text = document.body.textContent ?? '';
    return text.includes('Depth ready') || text.includes('Depth analysis failed');
  }, undefined, { timeout: 120_000 });
  const depthStatus = await lensBlurSection.textContent();
  if (!depthStatus?.includes('Depth ready')) {
    throw new Error(`Lens Blur depth did not become ready: ${depthStatus}`);
  }
  const focusDistance = lensBlurSection.getByLabel('Focus Distance', { exact: true });
  await focusDistance.scrollIntoViewIfNeeded();
  const focusBounds = await focusDistance.boundingBox();
  if (!focusBounds) throw new Error('Lens Blur focus-distance slider has no bounds.');
  await page.mouse.move(focusBounds.x + focusBounds.width * 0.5, focusBounds.y + focusBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(focusBounds.x + focusBounds.width * 0.78, focusBounds.y + focusBounds.height / 2, { steps: 8 });
  await page.waitForTimeout(80);
  const liveFocusDistance = await lensBlurSection.locator('.lighttable-lens-blur__visualization')
    .evaluate((element) => element.style.getPropertyValue('--focus-distance'));
  const liveFocusSlider = await focusDistance.inputValue();
  if (Number.parseFloat(liveFocusDistance) < 65) {
    throw new Error(`Lens Blur visualization did not update during drag: ${liveFocusDistance} (slider ${liveFocusSlider}).`);
  }
  await page.mouse.up();
  interactionTelemetry['Lens Blur visualization'] = {
    focusDistance: liveFocusDistance,
    slider: liveFocusSlider
  };
  const aperture = lensBlurSection.getByLabel('Aperture Size', { exact: true });
  await aperture.focus();
  await aperture.press('End');
  const depthOfField = lensBlurSection.getByLabel('Depth of Field', { exact: true });
  await depthOfField.focus();
  await depthOfField.press('Home');
  await page.waitForTimeout(2_000);
  const lensBlur = await exportPng('lens-blur');
  metrics['Lens Blur'] = await difference(neutral, lensBlur);
  await lensBlurSection.getByRole('radio', { name: 'Depth', exact: true }).click();
  const depthView = await exportPng('lens-blur-depth');
  metrics['Lens Blur Depth View'] = await difference(lensBlur, depthView);
  await page.getByRole('switch', { name: 'Disable Lens Blur' }).click();
  const lensBlurBypassed = await exportPng('lens-blur-disabled');
  bypassMetrics['Lens Blur'] = await difference(neutral, lensBlurBypassed);

  await page.screenshot({ path: path.join(output, 'lens-fx-panel.png') });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ sourcePath, metrics, bypassMetrics, errors }, null, 2)}\n`);
  const actionableErrors = errors.filter((message) => !message.includes('[W:onnxruntime:'));
  if (actionableErrors.length) throw new Error(`Renderer errors: ${JSON.stringify(actionableErrors)}`);
  for (const [effect, value] of Object.entries(metrics)) {
    if (effect === 'Lens Blur Depth View') {
      if (value > 0.000001) throw new Error(`Depth visualization contaminated export (${value} RMSE).`);
      continue;
    }
    if (value < 0.002) throw new Error(`${effect} did not materially change the production render (${value} RMSE).`);
  }
  for (const [effect, value] of Object.entries(bypassMetrics)) {
    if (value > 0.000001) throw new Error(`${effect} did not return to exact bypass (${value} RMSE).`);
  }
  process.stdout.write(`Lens FX UI smoke: ${JSON.stringify({
    metrics,
    bypassMetrics,
    interactionTelemetry
  })}\n`);
} finally {
  await app.close().catch(() => undefined);
}
