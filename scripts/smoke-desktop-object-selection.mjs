import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\face.jpg');
const interactionMode = process.argv.includes('--rectangle') ? 'rectangle' : 'object-finder';
const refineNegative = process.argv.includes('--negative');
const optionValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const caseName = optionValue('--case', path.parse(sourceFile).name).replace(/[^a-z0-9_-]+/gi, '-');
const clickXRatio = Number(optionValue('--x', '0.68'));
const clickYRatio = Number(optionValue('--y', '0.4'));
const outputDirectory = path.join(workspaceRoot, 'tmp', 'object-selection-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, `${caseName}-committed.png`);
const reportPath = path.join(outputDirectory, `${caseName}-report.json`);

if (![clickXRatio, clickYRatio].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
  throw new Error('Object Selection smoke --x and --y must be numbers between 0 and 1.');
}

await access(sourceFile);
await mkdir(userDataPath, { recursive: true });
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
    app, page, outputDirectory, sourceFile, pageErrors, label: 'object-selection'
  });
  await openFile.click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });

  const selectionMaster = page.getByRole('button', { name: /^Magic Wand/ }).first();
  await selectionMaster.dispatchEvent('mousedown');
  const objectButton = page.getByRole('button', { name: 'Object Selection' });
  await objectButton.waitFor({ state: 'visible' });
  await objectButton.click();
  const objectSelectionSettings = page.locator('[aria-label="Object Selection settings"]:visible');
  await objectSelectionSettings.waitFor({ state: 'visible' });
  if (interactionMode === 'rectangle') {
    const modeSelect = objectSelectionSettings.getByLabel('Object Selection mode');
    await modeSelect.selectOption('rectangle');
    await modeSelect.evaluate((select) => {
      if (!(select instanceof HTMLSelectElement) || select.value !== 'rectangle') {
        throw new Error('The visible Object Selection mode control did not enter Rectangle mode.');
      }
    });
    await page.waitForTimeout(250);
  }

  const canvas = page.locator('.lighttable-viewport__canvas');
  await page.evaluate(() => {
    globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__ = [];
    globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__ = [];
  });
  const beforeSelection = await canvas.screenshot();
  const clickPoint = await page.evaluate(({ clickXRatio, clickYRatio }) => {
    const target = document.querySelector('.lighttable-viewport__canvas');
    if (!(target instanceof HTMLCanvasElement)) return undefined;
    const bounds = target.getBoundingClientRect();
    // Fit-view always keeps the document center at the viewport center. Prefer
    // that invariant over guessing from the full viewport dimensions, which
    // include black pasteboard around portrait/square documents.
    for (const [xRatio, yRatio] of [[clickXRatio, clickYRatio], [0.5, 0.5], [0.3, 0.3]]) {
      const x = bounds.left + bounds.width * xRatio;
      const y = bounds.top + bounds.height * yRatio;
      if (document.elementFromPoint(x, y) === target) return { x, y };
    }
    return undefined;
  }, { clickXRatio, clickYRatio });
  if (!clickPoint) throw new Error('No unobstructed canvas point is available.');

  const startedAt = performance.now();
  if (interactionMode === 'rectangle') {
    await page.mouse.move(clickPoint.x - 24, clickPoint.y - 24);
    await page.mouse.down();
    await page.mouse.move(clickPoint.x + 24, clickPoint.y + 24, { steps: 8 });
    await page.mouse.up();
  } else {
    await page.mouse.click(clickPoint.x, clickPoint.y);
    if (refineNegative) {
      await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
        ?.some((entry) => entry.event === 'candidate-published'), undefined, { timeout: 45_000 });
      await canvas.dispatchEvent('pointerdown', {
        pointerId: 72, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: clickPoint.x - 90, clientY: clickPoint.y, altKey: true
      });
      await canvas.dispatchEvent('pointerup', {
        pointerId: 72, pointerType: 'mouse', button: 0, buttons: 0,
        clientX: clickPoint.x - 90, clientY: clickPoint.y, altKey: true
      });
      await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
        ?.some((entry) => entry.event === 'point-requested' && entry.detail?.label === 'negative'), undefined, { timeout: 5_000 });
    }
  }
  try {
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
      ?.some((entry) => entry.event === 'candidate-published'), undefined, { timeout: 45_000 });
    const applyButton = objectSelectionSettings.getByRole('button', { name: 'Apply', exact: true });
    await applyButton.click();
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
      ?.some((entry) => entry.event === 'apply-requested'), undefined, { timeout: 5_000 });
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__?.some((entry) => (
      entry.operationCount === 1 && entry.sourceKind === 'raster-mask' && entry.visible && entry.maskActive
    )), undefined, { timeout: 15_000 });
    const boxError = await page.evaluate(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
      ?.find((entry) => entry.event === 'box-error'));
    if (boxError) throw new Error(`Object Selection box failed: ${JSON.stringify(boxError)}`);
  } catch {
    const trace = await page.evaluate(() => ({
      overlay: globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__,
      smartSelection: globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__
    }));
    const status = await page.locator('body').innerText();
    throw new Error(`Object Selection did not publish an active raster selection: ${JSON.stringify({ trace, status })}`);
  }
  let visibleCommitMs;
  const deadline = startedAt + 120_000;
  while (performance.now() < deadline) {
    const body = await page.locator('body').innerText();
    const failureText = body.match(/Object Selection is unavailable[^\n]*|object selection could not be applied[^\n]*/i)?.[0];
    if (failureText) throw new Error(failureText);
    const frame = await canvas.screenshot();
    if (!frame.equals(beforeSelection)) {
      await page.waitForTimeout(500);
      const settledFrame = await canvas.screenshot();
      if (!settledFrame.equals(beforeSelection)) {
        visibleCommitMs = performance.now() - startedAt;
        break;
      }
    }
    await page.waitForTimeout(50);
  }
  if (visibleCommitMs === undefined) {
    throw new Error('Object Selection produced no persistent visible canvas update.');
  }
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !(
    message.includes('onnxruntime')
    && (message.includes("can't constant fold")
      || message.includes('were not assigned to the preferred execution providers')
      || message.includes('Rerunning with verbose output on a non-minimal build'))
  ));
  if (pageErrors.length || unexpectedConsoleErrors.length) {
    throw new Error(`Runtime errors: ${JSON.stringify({
      pageErrors, consoleErrors: unexpectedConsoleErrors
    })}`);
  }
  await page.screenshot({ path: screenshotPath });
  const selectionTrace = await page.evaluate(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__);
  const smartSelectionTrace = await page.evaluate(() => globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__);
  const publishedCandidates = smartSelectionTrace
    ?.filter((entry) => entry.event === 'candidate-published') ?? [];
  const finalCoverage = publishedCandidates.at(-1)?.detail;
  if (!finalCoverage || finalCoverage.selectedMean < 0.85) {
    throw new Error(
      `Object Selection produced an excessively translucent mask: ${JSON.stringify(finalCoverage)}`
    );
  }
  const report = {
    caseName, sourceFile, interactionMode, refineNegative, clickXRatio, clickYRatio,
    visibleCommitMs, finalCoverage, selectionTrace, smartSelectionTrace, pageErrors,
    consoleErrors: unexpectedConsoleErrors, runtimeWarnings: consoleErrors.length, screenshotPath
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Object Selection desktop smoke passed; persistent canvas feedback in ${visibleCommitMs.toFixed(1)} ms. `
    + `Screenshot: ${screenshotPath}\n`
  );
} catch (error) {
  failure = error;
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
} finally {
  await app.close();
}
if (failure) process.exitCode = 1;
