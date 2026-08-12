import { _electron as electron } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveDesktopTestLaunch, waitForDesktopLauncher } from './desktop-test-startup.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const sourceFile = path.resolve(process.argv[2] ?? 'D:\\face.jpg');
const outputDirectory = path.join(workspaceRoot, 'tmp', 'object-selection-smoke');
const userDataPath = path.join(outputDirectory, `user-data-${process.pid}`);
const screenshotPath = path.join(outputDirectory, 'object-selection-committed.png');
const reportPath = path.join(outputDirectory, 'report.json');

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
  await page.getByLabel('Object Selection settings').waitFor({ state: 'visible' });

  const canvas = page.locator('.lighttable-viewport__canvas');
  await page.evaluate(() => {
    globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__ = [];
    globalThis.__LIGHTTABLE_SMART_SELECTION_TRACE__ = [];
  });
  const beforeSelection = await canvas.screenshot();
  const clickPoint = await page.evaluate(() => {
    const target = document.querySelector('.lighttable-viewport__canvas');
    if (!(target instanceof HTMLCanvasElement)) return undefined;
    const bounds = target.getBoundingClientRect();
    for (const [xRatio, yRatio] of [[0.62, 0.42], [0.5, 0.5], [0.4, 0.45]]) {
      const x = bounds.left + bounds.width * xRatio;
      const y = bounds.top + bounds.height * yRatio;
      if (document.elementFromPoint(x, y) === target) return { x, y };
    }
    return undefined;
  });
  if (!clickPoint) throw new Error('No unobstructed canvas point is available.');

  const startedAt = performance.now();
  await page.mouse.click(clickPoint.x, clickPoint.y);
  try {
    await page.waitForFunction(() => globalThis.__LIGHTTABLE_SELECTION_OVERLAY_TRACE__?.some((entry) => (
      entry.operationCount === 1 && entry.sourceKind === 'raster-mask' && entry.visible && entry.maskActive
    )), undefined, { timeout: 45_000 });
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
  const report = {
    sourceFile, visibleCommitMs, selectionTrace, smartSelectionTrace, pageErrors,
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
