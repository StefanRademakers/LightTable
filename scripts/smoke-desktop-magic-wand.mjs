import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const positionalArguments = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const generated4k = process.argv.includes('--generated-4k');
const sourceFile = generated4k
  ? path.join(workspaceRoot, 'tmp', 'magic-wand-smoke', 'magic-wand-4k.png')
  : path.resolve(positionalArguments[0] ?? 'D:\\shapes.psd');
const contiguous = !process.argv.includes('--noncontiguous');
const sampleAllLayers = process.argv.includes('--sample-all-layers');
const sampleSize = process.argv.find((argument) => argument.startsWith('--sample-size='))?.split('=')[1] ?? '5';
const outputDirectory = path.join(workspaceRoot, 'tmp', 'magic-wand-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const variant = `${generated4k ? '4k' : 'source'}-${contiguous ? 'contiguous' : 'all'}-${sampleAllLayers ? 'composite' : 'active'}`;
const reportPath = path.join(outputDirectory, `report-${variant}.json`);
const screenshotPath = path.join(outputDirectory, `magic-wand-${variant}.png`);

await mkdir(userDataPath, { recursive: true });
if (generated4k) {
  const fixture = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160">
      <rect width="3840" height="2160" fill="#202830"/>
      <rect x="320" y="270" width="1280" height="1500" fill="#808080"/>
      <rect x="2200" y="270" width="1280" height="1500" fill="#808080"/>
      <rect x="1550" y="1000" width="650" height="160" fill="#202830"/>
      <rect x="1780" y="1030" width="190" height="100" fill="#808080"/>
    </svg>
  `);
  await sharp(fixture).png().toFile(sourceFile);
} else {
  await access(sourceFile);
}
const launchEnvironment = { ...process.env };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const launch = await resolveDesktopTestLaunch(workspaceRoot);
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

let failure;
try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const openFile = await waitForDesktopLauncher({
    app, page, outputDirectory, sourceFile, pageErrors, label: 'magic-wand'
  });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const selectionMaster = page.getByRole('button', { name: /^Rectangular selection/ }).first();
  await selectionMaster.dispatchEvent('mousedown');
  const wandButton = page.getByRole('button', { name: 'Magic Wand' });
  await wandButton.waitFor({ state: 'visible' });
  await wandButton.click();
  await page.getByLabel('Magic Wand settings').waitFor({ state: 'visible' });
  await page.keyboard.press('v');
  await page.getByLabel('Magic Wand settings').waitFor({ state: 'hidden' });
  await page.keyboard.press('w');
  await page.getByLabel('Magic Wand settings').waitFor({ state: 'visible' });
  await page.getByLabel('Magic Wand sample size').selectOption(sampleSize);
  await page.getByLabel('Tolerance').fill('20');
  await page.getByLabel('Contiguous').setChecked(contiguous);
  await page.getByLabel('Sample All Layers').setChecked(sampleAllLayers);
  await page.evaluate(() => { globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__ = []; });

  const canvas = page.locator('.lighttable-viewport__canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas bounds are unavailable.');
  const clickPoint = await page.evaluate(() => {
    const target = document.querySelector('.lighttable-viewport__canvas');
    if (!(target instanceof HTMLCanvasElement)) return undefined;
    const bounds = target.getBoundingClientRect();
    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const x = bounds.left + bounds.width * xRatio;
        const y = bounds.top + bounds.height * yRatio;
        if (document.elementFromPoint(x, y) === target) return { x, y };
      }
    }
    return undefined;
  });
  if (!clickPoint) throw new Error('No unobstructed canvas point is available.');
  const beforeSelection = await canvas.screenshot();
  const startedAt = performance.now();
  await page.mouse.click(clickPoint.x, clickPoint.y);
  let visibleUpdateMs;
  const deadline = startedAt + 10_000;
  while (performance.now() < deadline) {
    const currentFrame = await canvas.screenshot();
    if (!currentFrame.equals(beforeSelection)) {
      visibleUpdateMs = performance.now() - startedAt;
      break;
    }
    await page.waitForTimeout(10);
  }
  if (visibleUpdateMs === undefined) throw new Error('Magic Wand produced no visible selection update.');
  await page.waitForFunction(() => globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__?.length === 1, undefined, {
    timeout: 10_000
  });
  for (const expectedCount of [2, 3]) {
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await page.waitForFunction(
      (count) => globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__?.length === count,
      expectedCount,
      { timeout: 10_000 }
    );
  }
  for (const [mode, expectedCount] of [
    ['Add to selection', 4],
    ['Subtract from selection', 5],
    ['Intersect with selection', 6]
  ]) {
    await page.getByRole('radio', { name: mode }).click();
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await page.waitForFunction(
      (count) => globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__?.length === count,
      expectedCount,
      { timeout: 10_000 }
    );
  }
  const gpuTimings = await page.evaluate(() => globalThis.__LIGHTTABLE_MAGIC_WAND_TRACE__);
  const modes = gpuTimings.slice(3).map((timing) => timing.mode);
  if (modes.join(',') !== 'add,subtract,intersect') {
    throw new Error(`Selection combine routing mismatch: ${modes.join(',')}`);
  }
  await page.waitForTimeout(100);
  const body = await page.locator('body').innerText();
  const failureText = body.match(/LightTable Magic Wand validation failed|Magic Wand selection could not be applied/i)?.[0];
  if (failureText) throw new Error(failureText);
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  await page.screenshot({ path: screenshotPath });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const report = { sourceFile, visibleUpdateMs, gpuTimings, pageErrors, consoleErrors, screenshotPath };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Magic Wand desktop smoke passed; GPU complete ${gpuTimings.map((timing) => timing.gpuCompleteMs.toFixed(1)).join(' / ')} ms, `
    + `visible screenshot ${visibleUpdateMs.toFixed(1)} ms. Report: ${reportPath}\n`
  );
} catch (error) {
  failure = error;
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
} finally {
  await app.close();
}
if (failure) process.exitCode = 1;
