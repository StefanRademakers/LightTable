import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';
import { resolveDesktopTestLaunch } from './desktop-test-startup.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const output = path.join(workspace, 'tmp', 'color-vibrance-ui-smoke');
const userData = path.join(output, `user-data-${process.pid}`);
const sourcePath = process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\RandomFiles\\face.jpg';
const launch = await resolveDesktopTestLaunch(workspace);
await mkdir(userData, { recursive: true });

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: launch.executablePath,
  args: launch.args,
  cwd: workspace,
  env: environment,
  timeout: 30_000
});

const difference = async (left, right) => {
  const [leftImage, rightImage] = await Promise.all([
    sharp(left).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  if (leftImage.info.width !== rightImage.info.width
    || leftImage.info.height !== rightImage.info.height) {
    throw new Error('Color and Vibrance comparison dimensions differ.');
  }
  let squaredError = 0;
  for (let index = 0; index < leftImage.data.length; index += 1) {
    const delta = (leftImage.data[index] - rightImage.data[index]) / 255;
    squaredError += delta * delta;
  }
  return Math.sqrt(squaredError / leftImage.data.length);
};

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  const driver = await attachLightTableAutomation(page, 'color-vibrance-ui-smoke');
  const artifact = await driver.registerInputArtifact(
    await readFile(sourcePath), path.basename(sourcePath), 'image/jpeg'
  );
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: artifact.id });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Opening the Color and Vibrance source returned no document.');
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
  const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Color and Vibrance adjustment layer', exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Color and Vibrance properties' });
  await panel.waitFor({ state: 'visible' });
  const reset = panel.getByRole('button', { name: 'Reset Color and Vibrance' });
  const cases = [
    ['temperature', 'Temperature'],
    ['tint', 'Tint'],
    ['vibrance', 'Vibrance'],
    ['saturation', 'Saturation']
  ];
  const metrics = {};
  for (const [id, label] of cases) {
    await reset.click();
    const slider = panel.getByLabel(label, { exact: true });
    await slider.focus();
    await slider.press('End');
    const rendered = await exportPng(id);
    metrics[id] = await difference(neutral, rendered);
    if (metrics[id] < 0.002) {
      throw new Error(`${label} did not materially change the production render (${metrics[id]} RMSE).`);
    }
  }
  await reset.click();
  const pointerSlider = panel.getByLabel('Temperature', { exact: true });
  const box = await pointerSlider.boundingBox();
  if (!box) throw new Error('Temperature slider has no pointer target.');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, y, { steps: 8 });
  await page.mouse.up();
  const pointerRendered = await exportPng('temperature-pointer-drag');
  metrics.pointerTemperature = await difference(neutral, pointerRendered);
  if (metrics.pointerTemperature < 0.002) {
    throw new Error(`Temperature pointer drag did not materially change the production render (${metrics.pointerTemperature} RMSE).`);
  }
  await reset.click();
  const pointerVibrance = panel.getByLabel('Vibrance', { exact: true });
  const vibranceBox = await pointerVibrance.boundingBox();
  if (!vibranceBox) throw new Error('Vibrance slider has no pointer target.');
  const vibranceY = vibranceBox.y + vibranceBox.height / 2;
  await page.mouse.move(vibranceBox.x + vibranceBox.width / 2, vibranceY);
  await page.mouse.down();
  await page.mouse.move(vibranceBox.x + vibranceBox.width * 0.85, vibranceY, { steps: 8 });
  await page.mouse.up();
  const pointerVibranceRendered = await exportPng('vibrance-pointer-drag');
  metrics.pointerVibrance = await difference(neutral, pointerVibranceRendered);
  if (metrics.pointerVibrance < 0.002) {
    throw new Error(`Vibrance pointer drag did not materially change the production render (${metrics.pointerVibrance} RMSE).`);
  }
  await page.screenshot({ path: path.join(output, 'color-vibrance-panel.png') });
  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' })
    .getByRole('menuitem', { name: 'New Color Balance adjustment layer', exact: true })
    .click();
  await page.getByRole('complementary', { name: 'Color Balance properties' })
    .waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'color-balance-panel.png') });
  if (errors.length) throw new Error(`Renderer errors: ${JSON.stringify(errors)}`);
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ sourcePath, metrics }, null, 2)}\n`);
  process.stdout.write(`Color and Vibrance UI smoke passed: ${JSON.stringify(metrics)}\n`);
} finally {
  await app.close().catch(() => undefined);
}
